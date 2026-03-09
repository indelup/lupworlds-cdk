# Quickstart: Auth & Permissions — Local Development Setup

**Branch**: `001-auth-permissions`
**Date**: 2026-03-04

---

## Prerequisites

- AWS CLI configured with dev account credentials
- Node.js 22+
- A Twitch application registered at [dev.twitch.tv/console](https://dev.twitch.tv/console)

---

## Step 1: Install New Dependency

```bash
npm install @aws-sdk/client-ssm
```

---

## Step 2: Provision SSM Parameters

Run these once in your dev AWS account. These values are never committed to source control.

```bash
# JWT signing secret (generate a strong random string)
aws ssm put-parameter \
  --name "/lupworlds/jwt/secret" \
  --value "$(openssl rand -base64 32)" \
  --type SecureString

# Bot API key (share this with whoever runs the bot process)
aws ssm put-parameter \
  --name "/lupworlds/bot/api-key" \
  --value "$(openssl rand -base64 32)" \
  --type SecureString

# Twitch client secret (from dev.twitch.tv/console)
aws ssm put-parameter \
  --name "/lupworlds/twitch/client-secret" \
  --value "<YOUR_TWITCH_CLIENT_SECRET>" \
  --type SecureString
```

---

## Step 3: Configure Twitch OAuth Redirect URI

In the Twitch developer console, add the following to your app's **OAuth Redirect URLs**:

```
https://<API_GATEWAY_ID>.execute-api.<REGION>.amazonaws.com/prod/auth/twitch/callback
```

For local testing (if using a local tunnel like ngrok):
```
https://<your-ngrok-subdomain>.ngrok.io/auth/twitch/callback
```

---

## Step 4: Deploy with CDK

```bash
# Review changes (required before every deploy)
npx cdk diff

# Deploy
npx cdk deploy
```

The CDK stack will automatically:
- Grant the Lambda IAM permission to read all `/lupworlds/*` SSM parameters
- Set the required non-sensitive environment variables on the Lambda

---

## Step 5: Test the Auth Flow

### Streamer login (browser):
1. Open: `https://id.twitch.tv/oauth2/authorize?client_id=<TWITCH_CLIENT_ID>&redirect_uri=<CALLBACK_URL>&response_type=code&scope=user:read:email`
2. Approve the Twitch authorization
3. Browser redirects to `<FRONTEND_URL>?token=<jwt>`
4. Copy the JWT — use it as `Authorization: Bearer <jwt>` in subsequent requests

### Bot request (curl):
```bash
# Read the bot API key from SSM
BOT_KEY=$(aws ssm get-parameter --name "/lupworlds/bot/api-key" --with-decryption --query Parameter.Value --output text)

# Call any endpoint as bot
curl -H "Authorization: Bearer $BOT_KEY" https://<api-url>/characters?worldId=<worldId>
```

### Verify a JWT (decode without verifying):
```bash
# Decode the JWT payload (base64 middle segment)
echo "<jwt>" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq .
```

### Issue an overlay token (streamer only):
```bash
curl -X POST https://<api-url>/auth/overlay-token \
  -H "Authorization: Bearer <streamer-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"worldId": "<worldId>"}'
```

---

## Environment Variables Reference

These are set by CDK — do not set them manually in production:

| Variable | Description |
|----------|-------------|
| `TWITCH_CLIENT_ID` | Twitch app client ID |
| `TWITCH_REDIRECT_URI` | Full callback URL for OAuth |
| `FRONTEND_URL` | Dashboard URL for post-login redirect |
| `JWT_SECRET_PARAM_NAME` | SSM path: `/lupworlds/jwt/secret` |
| `BOT_API_KEY_PARAM_NAME` | SSM path: `/lupworlds/bot/api-key` |
| `TWITCH_CLIENT_SECRET_PARAM_NAME` | SSM path: `/lupworlds/twitch/client-secret` |
