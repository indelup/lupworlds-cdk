export type Role = "streamer" | "viewer" | "bot" | "overlay";

export interface AccessTokenPayload {
    iss: "lupworlds";
    aud: "api";
    typ: "access";
    sub: string;
    iat: number;
    platform: string;
    platformId: string;
    roles: Role[];
    worldId: string;
}

export interface OverlayTokenPayload {
    iss: "lupworlds";
    aud: "overlay";
    typ: "overlay";
    wid: string;
    iat: number;
}

export interface ServiceTokenPayload {
    iss: "lupworlds";
    aud: "api";
    typ: "service";
    sub: "bot";
    iat: number;
}

export type CallerContext =
    | {
          type: "user";
          userId: string;
          platform: string;
          platformId: string;
          roles: Role[];
          worldId: string;
      }
    | {
          type: "overlay";
          wid: string;
      }
    | {
          type: "bot";
      };

export interface TwitchUserInfo {
    id: string;
    display_name: string;
    email?: string;
}

export type AppEnv = {
    Variables: {
        caller: CallerContext;
        worldId: string;
        existingItem: Record<string, unknown>;
    };
};
