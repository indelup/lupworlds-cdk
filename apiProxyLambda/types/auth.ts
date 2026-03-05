export type Role = "streamer" | "viewer" | "bot" | "overlay";

export type OverlayScope = "world:read" | "playerdata:read";

export interface AccessTokenPayload {
    iss: "lupworlds";
    aud: "api";
    typ: "access";
    sub: string;
    iat: number;
    platform: string;
    platformId: string;
    roles: Role[];
    ownedWorldIds: string[];
}

export interface OverlayTokenPayload {
    iss: "lupworlds";
    aud: "overlay";
    typ: "overlay";
    wid: string;
    scopes: OverlayScope[];
    iat: number;
}

export interface ServiceTokenPayload {
    iss: "lupworlds";
    aud: "api";
    typ: "service";
    sub: "bot";
    scopes: ["bot:*"];
    iat: number;
}

export type CallerContext =
    | {
          type: "user";
          userId: string;
          platform: string;
          platformId: string;
          roles: Role[];
          ownedWorldIds: string[];
      }
    | {
          type: "overlay";
          wid: string;
          scopes: OverlayScope[];
      }
    | {
          type: "bot";
          scopes: ["bot:*"];
      };

export interface TwitchUserInfo {
    id: string;
    display_name: string;
    email?: string;
}

export type AppEnv = { Variables: { caller: CallerContext } };
