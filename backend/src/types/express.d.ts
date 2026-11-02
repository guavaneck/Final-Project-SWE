declare global {
  namespace Express {
    interface Request {
      auth?: {
        sessionId: string;
        user: {
          id: string;
          username: string;
          email: string;
          displayName: string;
        };
      };
    }
  }
}

export {};
