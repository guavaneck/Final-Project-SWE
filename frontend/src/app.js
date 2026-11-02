const state = {
    view: 'home',        
    communityId: null,
    postId: null,
    communities: []
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function timeAgo(t) {
    const mins = Math.round((Date.now() - t) / 6e4);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    return Math.round(mins / 60) + 'h ago';
}



const communityName = (id) =>
    (state.communities.find((c) => c.id === id) || {}).name || '?';

function go(view, extra = {}) {
    Object.assign(state, { view, communityId: null, postId: null }, extra);
    render();
}
// Main 
async function render() {
    const [user, communities] = await Promise.all([api.getUser(), api.listCommunities()]);
    state.communities = communities;
    $('userBtn').textContent = 'u/' + user.name;
    $('nav').innerHTML =
    `<a class="navitem ${state.view === 'home' && !state.communityId ? 'active' : ''}" onclick="go('home')">Home</a>`;
    $('communities').innerHTML = communities.map((c) =>
    `<a class="navitem ${state.communityId === c.id ? 'active' : ''}"
    onclick="go('home',{communityId:${c.id}})">c/${esc(c.name)}</a>`
  ).join('');
  const main = $('main');
    switch (state.view) {
        case 'home':         main.innerHTML = await feedView(); break;
        case 'post':         main.innerHTML = await postView(user); break;
        case 'newPost':      main.innerHTML = newPostView(); break;
        case 'newCommunity': main.innerHTML = newCommunityView(); break;
        case 'profile':      main.innerHTML = profileView(user); break;
    }
}
// Feed Area
async function feedView() {
    const query = $('q').value.toLowerCase();
    const posts = (await api.listPosts()).filter((p) =>
    (!state.communityId || p.communityId === state.communityId) &&
    (p.title + p.body).toLowerCase().includes(query)
    );
    const c = state.communities.find((x) => x.id === state.communityId);
    const header = c
    ? `<div class="card">
    <h2 class="flush">c/${esc(c.name)}</h2>
    <p class="meta">${esc(c.desc)} · ${c.members} members · Mods: ${c.mods.map(esc).join(', ')}</p>
    </div>`: '';
    return header + (posts.map(postCard).join('') || '<div class="empty">No posts yet.</div>');
}

function postCard(p) {
    return `
    <div class="card post">
    <div class="votes">
    <button class="${p.vote === 1 ? 'on' : ''}" onclick="vote(${p.id},${p.vote === 1 ? 0 : 1})">▲</button>
    <b>${p.score}</b>
    <button class="${p.vote === -1 ? 'on' : ''}" onclick="vote(${p.id},${p.vote === -1 ? 0 : -1})">▼</button>
    </div>
    <div>
    <div class="meta">
    <span class="tag">c/${esc(communityName(p.communityId))}</span>
    u/${esc(p.author)} · ${timeAgo(p.created)}
    </div>
    <h2 onclick="go('post',{postId:${p.id}})">${esc(p.title)}</h2>
    <div>${esc(p.body).slice(0, 200)}</div>
    <div class="meta">
    <button class="link" onclick="go('post',{postId:${p.id}})">💬 ${p.comments.length} comments</button>
    <button class="link" onclick="alert('Reposted to another community')">↻ Repost</button>
    </div>
    </div>
    </div>`;
}

async function vote(id, value) {
    await api.votePost(id, value);
    render();
}
// Post and  comments 
async function postView(user) {
    const p = await api.getPost(state.postId);
    if (!p) return '<div class="empty">Post not found.</div>';
    const community = state.communities.find((c) => c.id === p.communityId);
    const isMod = community && community.mods.includes(user.name);
    const modTools = isMod
    ? `<div class="card meta">Moderator tools:
    <button class="link danger" onclick="removePost(${p.id})">Delete post</button>
    <button class="link" onclick="alert('Banned user')">Ban user</button>
    </div>`: '';
    const comments = p.comments.map((c) =>
    `<div class="comment">
    <div class="meta">u/${esc(c.author)} · ${timeAgo(c.created)}</div>
    ${esc(c.body)}
    </div>`
  ).join('') || '<div class="empty">Be the first to comment.</div>';
    return `
    <button class="link" onclick="go('home')">← Back</button>
    ${postCard(p)}
    ${modTools}
    <div class="card">
    <label for="commentBody">Add a comment</label>
    <textarea id="commentBody"></textarea>
    <div class="row top-gap"><button class="primary" onclick="submitComment(${p.id})">Comment</button></div>
    </div>
    <div class="card"><h3>Comments</h3>${comments}</div>`;
}

async function submitComment(postId) {
    const body = $('commentBody').value.trim();
    if (!body) return;
    await api.addComment(postId, body);
    render();
}

async function removePost(id) {
    await api.deletePost(id);
    go('home');
}

// Crreating the post
function newPostView() {
    const options = state.communities
    .map((c) => `<option value="${c.id}">c/${esc(c.name)}</option>`).join('');
    return `
    <div class="card">
    <h2 class="flush">Create post</h2>
    <label for="postCommunity">Community</label>
    <select id="postCommunity">${options}</select>
    <label for="postTitle">Title</label>
    <input type="text" id="postTitle">
    <label for="postBody">Body</label>
    <textarea id="postBody"></textarea>
    <div class="row top-gap">
    <button class="primary" onclick="submitPost()">Publish</button>
    <button onclick="go('home')">Cancel</button>
    </div>
    </div>`;
}

async function submitPost() {
    const title = $('postTitle').value.trim();
    if (!title) return alert('Title required');
    const post = await api.createPost({
        communityId: Number($('postCommunity').value),
        title,
        body: $('postBody').value
    });
    go('post', { postId: post.id });
}

// Creating a community 
function newCommunityView() {
    return `
    <div class="card">
    <h2 class="flush">Create community</h2>
    <label for="communityName">Name</label>
    <input type="text" id="communityName">
    <label for="communityDesc">Description</label>
    <textarea id="communityDesc"></textarea>
    <div class="row top-gap">
    <button class="primary" onclick="submitCommunity()">Create</button>
    <button onclick="go('home')">Cancel</button>
    </div>
    </div>`;
}

async function submitCommunity() {
    const name = $('communityName').value.trim().replace(/\s+/g, '-').toLowerCase();
    if (!name) return alert('Name required');
    const c = await api.createCommunity({ name, desc: $('communityDesc').value });
    go('home', { communityId: c.id });
}

// Profile page 
function profileView(u) {
    return `
    <div class="card">
    <div class="row">
    <span class="avatar lg">${esc(u.name[0] || '?').toUpperCase()}</span>
    <div>
    <h2 class="flush">u/${esc(u.name)}</h2>
    <div class="meta">Joined ${new Date(u.joined).toLocaleDateString()}</div>
    </div>
    </div>
    <label for="profileName">Username</label>
    <input type="text" id="profileName" value="${esc(u.name)}">
    <label for="profileBio">Bio</label>
    <textarea id="profileBio">${esc(u.bio)}</textarea>
    <div class="row top-gap"><button class="primary" onclick="saveProfile()">Save profile</button></div>
    </div>`;
}

async function saveProfile() {
    const name = $('profileName').value.trim();
    if (!name) return;
    await api.updateUser({ name, bio: $('profileBio').value });
    render();
}
render();




