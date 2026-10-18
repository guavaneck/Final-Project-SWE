// Shared object types (User, Post, Comment, etc.) used across routes, controllers, and services so everyone uses the same shapes.
// Belongs here: e.g. a Vote interface with userId, targetId, and value (1 or -1). Only type definitions, no logic.

export interface MediaAttachment{
    type: 'image' | 'video';
    url: string;
}

export interface User {
    userId: number;
    username: string;
    passwordHash: string;
    email: string;
    createdAt: Date;
    bio?: string;
}

export type PublicUser = Omit<User, 'passwordHash' | 'email'>;

export interface Post {
    postId: number;
    communityId?: number;
    authorId: number;
    title: string;
    body?: string;
    media: MediaAttachment[];
    createdAt: Date;
    updatedAt: Date;
    score: number;
    commentCount: number;
}

export interface Comment {
    commentId: number;
    postId: number;
    authorId: number;
    body?: string;
    media: MediaAttachment[];
    createdAt: Date;
    updatedAt: Date;
    score: number;
}

export interface Community {
    communityId: number;
    createrId: number;
    name: string;
    description: string;
    createdAt: Date;
    memberCount: number;
    moderatorIds: number;
}