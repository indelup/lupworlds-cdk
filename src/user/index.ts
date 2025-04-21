//exports.handler = async (_event: any) => {
//    return {
//        statusCode: 200,
//        body: JSON.stringify("Hello from Lambda!"),
//    };
//};

// User Handler
const ddb = require('@aws-sdk/client-dynamodb');
const client = new ddb.DynamoDBClient({ region: process.env.AWS_REGION });

// Get the table name from the Environment Variable set by aws-lambda-dynamodb
const userTableName = process.env.DDB_TABLE_NAME;

type User = {
    id: string;
    twitchId: string;
    alias: string;
    allowedRoles: string[];
    worldIds: string[];
}

exports.handler = async (event: any) => {
    let result: any;

    try {
        console.log('Event:', JSON.stringify(event));
        // Normalize path by getting the last segment
        const normalizedPath = '/' + event.path.split('/').filter(Boolean).pop();
        console.log('Normalized path:', normalizedPath);

        if (event.httpMethod === 'POST' && normalizedPath === '/users') {
            const body = JSON.parse(event.body);
            console.log('Parsed body:', JSON.stringify(body));
            const newId = await createUser(body);
            result = { id: newId };
        } else if (event.httpMethod === 'GET' && normalizedPath === '/users') {
            result = await listUsers();
        } else if (event.httpMethod === 'GET' && event.pathParameters?.userId) {
            result = await getUser(event.pathParameters.userId);
        } else {
            console.log(`Unsupported method: ${event.httpMethod} path: ${normalizedPath}`);
            throw { statusCode: 405 };
        }
    } catch (e: any) {
        console.error('Error:', e);
        return createReturnObject(e.statusCode || 500);
    }

    return createReturnObject(200, JSON.stringify(result));
};

async function getUser(userId: string): Promise<User> {
    try {
        const command = new ddb.GetItemCommand({
            TableName: userTableName,
            Key: {
                "id": { S: userId }
            }
        });

        const data = await client.send(command);
        if (!data.Item) {
            throw { statusCode: 404 };
        }

        return {
            id: data.Item.id.S,
            twitchId: data.Item.twitchId.S,
            alias: data.Item.alias.S,
            allowedRoles: data.Item.allowedRoles.SS,
            worldIds: data.Item.worldIds.SS
        };
    } catch (e) {
        console.log(`Failed Dynamodb processing: ${JSON.stringify(e)}`);
        throw { statusCode: 500 };
    }
}

async function listUsers(): Promise<User[]> {
    try {
        const command = new ddb.ScanCommand({
            TableName: userTableName
        });

        const data = await client.send(command);
        return (data.Items || []).map((item: any) => ({
            id: item.id.S,
            twitchId: item.twitchId.S,
            alias: item.alias.S,
            allowedRoles: item.allowedRoles.SS,
            worldIds: item.worldIds.SS
        }));
    } catch (e) {
        console.log(`Failed Dynamodb processing: ${JSON.stringify(e)}`);
        throw { statusCode: 500 };
    }
}

async function createUser(user: Omit<User, 'id'>): Promise<string> {
    try {
        const newId = `usr${Date.now()}`;
        const command = new ddb.PutItemCommand({
            TableName: userTableName,
            Item: {
                'id': { S: newId },
                'twitchId': { S: user.twitchId },
                'alias': { S: user.alias },
                'allowedRoles': { SS: user.allowedRoles },
                'worldIds': { SS: user.worldIds?.length > 0 ? user.worldIds : [''] }
            }
        });

        await client.send(command);
        return newId;
    } catch (e) {
        console.error('Failed DynamoDB processing:', JSON.stringify(e));
        throw { statusCode: 500 };
    }
}

function createReturnObject(httpStatusCode: number, body?: string) {
    console.log(httpStatusCode);
    console.log(JSON.stringify(body));
    return {
        statusCode: httpStatusCode,
        headers: { "Content-Type": "application/json" },
        body: httpStatusCode === 200 ? body : undefined,
    };
}
