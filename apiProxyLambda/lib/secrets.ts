import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});

async function fetchSecureString(paramName: string): Promise<string> {
    const response = await ssm.send(
        new GetParameterCommand({ Name: paramName, WithDecryption: true }),
    );
    const value = response.Parameter?.Value;
    if (!value) throw new Error(`SSM parameter not found or empty: ${paramName}`);
    return value;
}

let cachedJwtSecret: Promise<string> | null = null;
let cachedTwitchClientSecret: Promise<string> | null = null;

export function getJwtSecret(): Promise<string> {
    if (!cachedJwtSecret) {
        const paramName =
            process.env.JWT_SECRET_PARAM_NAME ?? "/lupworlds/jwt/secret";
        cachedJwtSecret = fetchSecureString(paramName);
    }
    return cachedJwtSecret;
}

export function getTwitchClientSecret(): Promise<string> {
    if (!cachedTwitchClientSecret) {
        const paramName =
            process.env.TWITCH_CLIENT_SECRET_PARAM_NAME ??
            "/lupworlds/twitch/client-secret";
        cachedTwitchClientSecret = fetchSecureString(paramName);
    }
    return cachedTwitchClientSecret;
}
