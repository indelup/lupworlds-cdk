import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { sign } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const app = new Hono();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);

interface TwitchUser {
    id: string;
    login: string;
    display_name: string;
    email: string;
    profile_image_url: string;
}

interface User {
    id: string;
    twitchId: string;
    alias: string;
    email: string;
    allowedRoles: string[];
    worldIds: string[];
    createdAt: string;
    lastLogin: string;
}

// Endpoint para iniciar autenticación con Twitch
// TODO: Revisar implementación de autenticación con Twitch
app.get("/auth", async (c) => {
    const twitchAuthUrl = `https://id.twitch.tv/oauth2/authorize?` +
        `client_id=${process.env.TWITCH_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(process.env.TWITCH_REDIRECT_URI!)}&` +
        `response_type=code&` +
        `scope=user:read:email&` +
        `state=${randomUUID()}`;

    return c.redirect(twitchAuthUrl);
});

// Callback de Twitch OAuth
app.get("/callback", async (c) => {
    const code = c.req.query("code");
    
    if (!code) {
        return c.redirect(process.env.FRONTEND_URL + '/login?error=no_code');
    }

    try {
        // 1. Intercambiar código por token de Twitch
        const twitchToken = await exchangeCodeForToken(code);
        
        // 2. Obtener datos del usuario de Twitch
        const twitchUser = await getTwitchUserData(twitchToken);
        
        // 3. Crear/actualizar usuario en DynamoDB
        const user = await createOrUpdateUser(twitchUser);
        
        // 4. Generar JWT propio
        const jwtPayload = {
            sub: user.id,
            twitchId: twitchUser.id,
            email: twitchUser.email,
            alias: twitchUser.display_name,
            roles: user.allowedRoles || [],
            worldIds: user.worldIds || [],
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 horas
        };
        
        const accessToken = sign(jwtPayload, process.env.JWT_SECRET!);
        
        // 5. Configurar cookie HTTPOnly y redirigir
        const cookieValue = `accessToken=${accessToken}; HttpOnly; Secure; SameSite=Strict; Max-Age=86400; Path=/`;
        
        return new Response(null, {
            status: 302,
            headers: {
                'Location': process.env.FRONTEND_URL + '/dashboard',
                'Set-Cookie': cookieValue,
            },
        });
    } catch (error) {
        console.error('Authentication error:', error);
        return c.redirect(process.env.FRONTEND_URL + '/login?error=auth_failed');
    }
});

// Endpoint para logout
app.post("/logout", async (c) => {
    return c.json({ success: true }, 200, {
        'Set-Cookie': 'accessToken=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/',
    });
});

export const handler = handle(app);

// Función para intercambiar código por token de Twitch
async function exchangeCodeForToken(code: string): Promise<string> {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: process.env.TWITCH_CLIENT_ID!,
            client_secret: process.env.TWITCH_CLIENT_SECRET!,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: process.env.TWITCH_REDIRECT_URI!,
        }),
    });
    
    if (!response.ok) {
        throw new Error(`Failed to exchange code for token: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.access_token;
}

// Función para obtener datos del usuario de Twitch
async function getTwitchUserData(accessToken: string): Promise<TwitchUser> {
    const response = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID!,
        },
    });
    
    if (!response.ok) {
        throw new Error(`Failed to get Twitch user data: ${response.statusText}`);
    }
    
    const data = await response.json();
    if (!data.data || data.data.length === 0) {
        throw new Error('No user data received from Twitch');
    }
    
    return data.data[0];
}

// Función para crear/actualizar usuario en DynamoDB
async function createOrUpdateUser(twitchUser: TwitchUser): Promise<User> {
    const tableName = process.env.USERS_TABLE_NAME;
    
    if (!tableName) {
        throw new Error('USERS_TABLE_NAME not configured');
    }

    // Buscar usuario existente por twitchId
    const scanCommand = new ScanCommand({
        TableName: tableName,
        FilterExpression: "twitchId = :twitchId",
        ExpressionAttributeValues: {
            ":twitchId": twitchUser.id,
        },
        Limit: 1,
    });
    
    const existingUser = await ddbDocClient.send(scanCommand);
    
    if (existingUser.Items && existingUser.Items.length > 0) {
        // Usuario existe, actualizar datos
        const user = existingUser.Items[0] as User;
        const updatedUser: User = {
            ...user,
            alias: twitchUser.display_name,
            email: twitchUser.email,
            lastLogin: new Date().toISOString(),
        };
        
        const putCommand = new PutCommand({
            TableName: tableName,
            Item: updatedUser,
        });
        
        await ddbDocClient.send(putCommand);
        return updatedUser;
    } else {
        // Crear nuevo usuario
        const newUser: User = {
            id: randomUUID(),
            twitchId: twitchUser.id,
            alias: twitchUser.display_name,
            email: twitchUser.email,
            allowedRoles: ["user"], // Rol por defecto
            worldIds: [],
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
        };
        
        const putCommand = new PutCommand({
            TableName: tableName,
            Item: newUser,
        });
        
        await ddbDocClient.send(putCommand);
        return newUser;
    }
}
