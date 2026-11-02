const TOKEN_KEY = 'token';

const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (token) => token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY);

async function request(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

const toUser = (u) => ({id: u.id, name: u.username, displayName: u.displayName, email: u.email, bio: '', joined: null});

const toComment = (c) => ({
  id: c.id,
  author: c.author ? c.author.username : '[deleted]',
  body: c.body ?? '[deleted]',
  deleted: Boolean(c.deletedAt),
  created: Date.parse(c.createdAt),
  score: c.score ?? 0,
  vote: c.viewerVote ?? 0,
  replies: (c.replies || []).map(toComment)
});

const toPost = (p, comments = null) => ({
  id: p.publicId,
  communityId: p.communityId,
  author: p.author.username,
  postType: p.postType,
  title: p.title,
  body: p.body ?? '',
  externalUrl: p.externalUrl,
  score: p.score,
  vote: p.viewerVote ?? 0,
  created: Date.parse(p.createdAt),
  comments
});

const api = {
  // Auth
  isLoggedIn: () => Boolean(getToken()),
  register: async ({username, email, displayName, password}) => {
    const data = await request('POST', '/auth/register', {username, email, displayName, password});
    setToken(data.token);
    return toUser(data.user);
  },
  login: async (login, password) => {
    const data = await request('POST', '/auth/login', {login, password});
    setToken(data.token);
    return toUser(data.user);
  },
  logout: async () => {
    try { await request('POST', '/auth/logout'); } finally { setToken(null); }
  },

  // Users
  getUser: async () => toUser((await request('GET', '/auth/me')).user),
  updateUser: async () => { throw new Error('Editing profiles is not supported yet'); },

  // Communities
  listCommunities: async () => (await request('GET', '/communities')).map((c) => ({
    id: c.id,
    name: c.slug,
    title: c.name,
    desc: c.description ?? '',
    members: c._count.memberships,
    mods: []
  })),
  createCommunity: async () => { throw new Error('Creating communities is not supported yet'); },

  // Posts
  listPosts: async (communityId) => {
    const path = communityId ? `/communities/${communityId}/posts` : '/posts/feed';
    const data = await request('GET', path);
    return data.posts.map((p) => toPost(p));
  },
  getPost: async (id) => {
    const [post, comments] = await Promise.all([
      request('GET', `/posts/${id}`),
      request('GET', `/posts/${id}/comments`)
    ]);
    return toPost(post, comments.map(toComment));
  },
  createPost: async ({communityId, title, body, postType = 'text', externalUrl}) =>
    toPost(await request('POST', '/posts', {communityId, postType, title, body, externalUrl})),
  deletePost: async (id) => { await request('DELETE', `/posts/${id}`); },

  votePost: (id, value) => value
    ? request('PUT', `/posts/${id}/vote`, {value})
    : request('DELETE', `/posts/${id}/vote`),

  // Comments
  addComment: async (postId, body, parentId) =>
    toComment(await request('POST', `/posts/${postId}/comments`, {body, parentId})),
  voteComment: (postId, commentId, value) => value
    ? request('PUT', `/posts/${postId}/comments/${commentId}/vote`, {value})
    : request('DELETE', `/posts/${postId}/comments/${commentId}/vote`)
};
