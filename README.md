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

Stop the services without deleting their data:

```sh
docker compose down
```
