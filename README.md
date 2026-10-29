# Social App

## Local database

The local stack uses PostgreSQL for application data and SeaweedFS for S3-compatible media storage.

1. Create the environment file:

   ```sh
   cp .env.example .env
   ```

2. Replace the example passwords in `.env`.

3. Install the backend dependencies:

   ```sh
   npm --prefix backend install
   ```

4. Start PostgreSQL and object storage:

   ```sh
   docker compose up -d
   ```

5. Apply the database migration:

   ```sh
   npm --prefix backend run db:migrate
   ```

PostgreSQL uses `POSTGRES_PORT`, and the S3-compatible media API uses `S3_PORT`. Their defaults are `5432` and `8333`. The configured `S3_BUCKET` is created automatically.

Prisma owns the schema, generated TypeScript client, and migrations. After changing `backend/prisma/schema.prisma`, create a development migration from the `backend` directory:

```sh
npx prisma migrate dev --name describe_the_change
```

Production and shared environments apply committed migrations with `npm --prefix backend run db:migrate`.

Application database functions are exported from `backend/src/db/index.ts`. API code can import only the operations it needs:

```ts
import { createPost, listHomeFeed } from "./db/index.js";
```

Open Prisma Studio to inspect local data:

```sh
npm --prefix backend run db:studio
```

Run the database integration test while PostgreSQL is running:

```sh
npm --prefix backend run test:db
```

Run the authentication unit tests (no database required):

```sh
npm --prefix backend run test:auth
```

## API authentication

Authentication uses opaque 30-day sessions. The raw token is returned once by registration or login; the database stores only its SHA-256 hash. Send it on protected requests as `Authorization: Bearer <token>`.

- `POST /api/auth/register` accepts `username`, `email`, `displayName`, `password`, and optional `deviceName`.
- `POST /api/auth/login` accepts `login` (username or email), `password`, and optional `deviceName`.
- `GET /api/auth/me` returns the current user.
- `POST /api/auth/logout` revokes the current session.

Creating, editing, or deleting posts and creating comments requires a bearer token. The authenticated user's ID is always used as the author; client-supplied author IDs are ignored. Post responses include both the stable `authorId` ownership key and `author.username` for display.

Post likes are authenticated and idempotent:

- `PUT /api/posts/:postId/like` likes a post.
- `DELETE /api/posts/:postId/like` removes the current user's like.

Both endpoints return `{ "liked": boolean, "likeCount": number }`. Post responses also include the total as `_count.likes`.

Stop the services without deleting their data:

```sh
docker compose down
```
