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

// Only media with a URL can be shown; the API leaves url null until an upload is ready.
const toMedia = (m) => ({
  id: m.id,
  kind: m.mimeType.startsWith('video/') ? 'video' : 'image',
  mimeType: m.mimeType,
  url: m.url,
  width: m.width,
  height: m.height,
  durationSeconds: m.durationSeconds
});

// Uploads straight to storage with the signed request from POST /api/media.
// XHR rather than fetch so large videos can report progress.
function putFile(upload, file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers || {})) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new Error(`Upload to storage failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload to storage failed. Check your connection and try again.'));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), {cancelled: true}));
    if (signal) signal.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

const toPost = (p, comments = null) => ({
  id: p.publicId,
  communityId: p.communityId,
  author: p.author.username,
  postType: p.postType,
  title: p.title,
  body: p.body ?? '',
  externalUrl: p.externalUrl,
  media: (p.media || []).filter((m) => m.url).map(toMedia),
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
  createPost: async ({communityId, title, body, postType = 'text', externalUrl, mediaIds}) =>
    toPost(await request('POST', '/posts', {communityId, postType, title, body, externalUrl, mediaIds})),
  deletePost: async (id) => { await request('DELETE', `/posts/${id}`); },

  votePost: (id, value) => value
    ? request('PUT', `/posts/${id}/vote`, {value})
    : request('DELETE', `/posts/${id}/vote`),

  // Media: declare the file, PUT it to storage, then have the API check it.
  // Rejections (wrong type, too big, failed checks) throw with the API's reason as the message.
  uploadMedia: async (file, {onProgress, signal} = {}) => {
    const {media, upload} = await request('POST', '/media', {mimeType: file.type, sizeBytes: file.size});
    await putFile(upload, file, onProgress, signal);
    return toMedia(await request('POST', `/media/${media.id}/complete`));
  },

  // Comments
  addComment: async (postId, body, parentId) =>
    toComment(await request('POST', `/posts/${postId}/comments`, {body, parentId})),
  voteComment: (postId, commentId, value) => value
    ? request('PUT', `/posts/${postId}/comments/${commentId}/vote`, {value})
    : request('DELETE', `/posts/${postId}/comments/${commentId}/vote`)
};
