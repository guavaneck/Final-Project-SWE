# Database ERD

Generated from [backend/prisma/schema.prisma](../backend/prisma/schema.prisma), including the `comment_depth` and `post_public_id` migrations.

```mermaid
erDiagram
    users ||--o{ sessions : "has"
    users ||--o{ communities : "creates"
    users ||--o{ community_memberships : "joins"
    communities ||--o{ community_memberships : "has members"
    users ||--o{ user_follows : "follows (follower_id)"
    users ||--o{ user_follows : "is followed (followed_id)"
    users ||--o{ posts : "authors"
    communities ||--o{ posts : "contains"
    posts ||--o{ comments : "has"
    users ||--o{ comments : "writes"
    comments |o--o{ comments : "parent of"
    posts ||--o{ post_likes : "receives"
    users ||--o{ post_likes : "gives"
    comments ||--o{ comment_likes : "receives"
    users ||--o{ comment_likes : "gives"
    users ||--o{ media_objects : "owns"
    media_objects |o--o{ users : "avatar for"
    posts ||--o{ post_media : "attaches"
    media_objects ||--o| post_media : "used in"

    users {
        uuid id PK
        varchar username UK "max 32"
        varchar email UK "max 320"
        text password_hash
        varchar display_name "max 80"
        varchar bio "nullable, max 500"
        account_status account_status "active | disabled | deleted"
        uuid avatar_media_id FK "nullable, SET NULL on delete"
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at "nullable"
    }

    sessions {
        uuid id PK
        uuid user_id FK "CASCADE"
        varchar token_hash UK "max 128"
        varchar device_name "nullable"
        timestamptz expires_at
        timestamptz revoked_at "nullable"
        timestamptz created_at
    }

    communities {
        uuid id PK
        uuid creator_id FK
        varchar slug UK "max 64"
        varchar name "max 100"
        varchar description "nullable, max 1000"
        visibility visibility "public | private"
        timestamptz created_at
        timestamptz updated_at
    }

    community_memberships {
        uuid community_id PK, FK "CASCADE"
        uuid user_id PK, FK "CASCADE"
        timestamptz joined_at
    }

    user_follows {
        uuid follower_id PK, FK "CASCADE"
        uuid followed_id PK, FK "CASCADE, != follower_id"
        timestamptz created_at
    }

    posts {
        uuid id PK
        varchar public_id UK "12-char Crockford base32"
        uuid author_id FK
        uuid community_id FK
        post_type post_type "text | link | media"
        varchar title "max 300"
        text body "nullable"
        text external_url "nullable"
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at "nullable"
    }

    comments {
        uuid id PK
        uuid post_id FK "CASCADE"
        uuid author_id FK
        uuid parent_id FK "nullable, same post as parent"
        text body "nullable only if deleted"
        int depth "default 0, >= 0"
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at "nullable"
    }

    post_likes {
        uuid post_id PK, FK "CASCADE"
        uuid user_id PK, FK "CASCADE"
        timestamptz created_at
    }

    comment_likes {
        uuid comment_id PK, FK "CASCADE"
        uuid user_id PK, FK "CASCADE"
        timestamptz created_at
    }

    media_objects {
        uuid id PK
        uuid owner_id FK
        varchar bucket "UK with object_key"
        text object_key "UK with bucket"
        varchar mime_type
        bigint size_bytes ">= 0"
        char checksum_sha256 "nullable"
        upload_status upload_status "pending | ready | failed"
        int width "nullable, > 0"
        int height "nullable, > 0"
        decimal duration_seconds "nullable, >= 0"
        timestamptz created_at
        timestamptz completed_at "nullable"
    }

    post_media {
        uuid post_id PK, FK "CASCADE"
        uuid media_id PK, FK "UK, one post per media"
        smallint position "UK with post_id, >= 0"
    }
```
