import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});

async function fetchSecureParam(name: string): Promise<string> {
    const result = await ssm.send(
        new GetParameterCommand({ Name: name, WithDecryption: true }),
    );
    const value = result.Parameter?.Value;
    if (!value) throw new Error(`SSM parameter not found: ${name}`);
    return value;
}

let jwtSecretPromise: Promise<string> | null = null;
let botJwtPromise: Promise<string> | null = null;
let twitchClientSecretPromise: Promise<string> | null = null;

export function getJwtSecret(): Promise<string> {
    const paramName = process.env.JWT_SECRET_PARAM_NAME ?? "/lupworlds/jwt/secret";
    if (!jwtSecretPromise) jwtSecretPromise = fetchSecureParam(paramName);
    return jwtSecretPromise;
}

export function getBotJwt(): Promise<string> {
    const paramName = process.env.BOT_JWT_PARAM_NAME ?? "/lupworlds/bot/jwt";
    if (!botJwtPromise) botJwtPromise = fetchSecureParam(paramName);
    return botJwtPromise;
}

export function getTwitchClientSecret(): Promise<string> {
    const paramName =
        process.env.TWITCH_CLIENT_SECRET_PARAM_NAME ?? "/lupworlds/twitch/client-secret";
    if (!twitchClientSecretPromise)
        twitchClientSecretPromise = fetchSecureParam(paramName);
    return twitchClientSecretPromise;
}
