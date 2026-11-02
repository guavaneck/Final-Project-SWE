const state = {
    view: 'home',        
    communityId: null,
    postId: null,
    communities: [],
    user: null,
    authMode: 'login',
    notice: null,
    replyTo: null
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const js = (s) => esc(JSON.stringify(String(s)));

function timeAgo(t) {
    const mins = Math.round((Date.now() - t) / 6e4);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    return Math.round(mins / 60) + 'h ago';
}



const communityName = (id) =>
    (state.communities.find((c) => c.id === id) || {}).name || String(id).slice(0, 8);

function go(view, extra = {}) {
    Object.assign(state, { view, communityId: null, postId: null, replyTo: null }, extra);
    render();
}

function noticeView() {
    const msg = state.notice;
    state.notice = null;
    return msg ? `<div class="card error">${esc(msg)}</div>` : '';
}

function fail(err) {
    state.notice = err.message;
    render();
}

// Main
let renderCount = 0;
let shownPage = null;

async function render() {
    const current = ++renderCount;
    const main = $('main');
    const loggedIn = api.isLoggedIn();
    $('q').hidden = !loggedIn;
    $('newPostBtn').hidden = !loggedIn;
    $('logoutBtn').hidden = !loggedIn;
    $('newCommunityBtn').hidden = true;

    if (!loggedIn) {
        state.user = null;
        shownPage = null;
        $('userBtn').textContent = 'Log in';
        $('nav').innerHTML = '';
        $('communities').innerHTML = '';
        main.innerHTML = noticeView() + authView();
        return;
    }

    $('nav').innerHTML =
    `<a class="navitem ${state.view === 'home' && !state.communityId ? 'active' : ''}" onclick="go('home')">Home</a>`;

    const page = [state.view, state.communityId, state.postId].join('|');
    if (page !== shownPage) main.innerHTML = '<div class="empty">Loading…</div>';

    try {
        if (!state.user) [state.user, state.communities] = await Promise.all([api.getUser(), api.listCommunities()]);
        $('userBtn').textContent = 'u/' + state.user.name;
        $('communities').innerHTML = state.communities.map((c) =>
        `<a class="navitem ${state.communityId === c.id ? 'active' : ''}"
        onclick="go('home',{communityId:${js(c.id)}})">c/${esc(c.name)}</a>`
        ).join('') || '<p class="meta">No communities yet.</p>';
        const html = await pageView(state.user);
        if (current !== renderCount) return;
        shownPage = page;
        main.innerHTML = noticeView() + html;
    } catch (err) {
        if (current !== renderCount) return;
        shownPage = null;
        if (err.status === 401) {
            state.notice = 'Your session has expired. Please log in again.';
            return render();
        }
        main.innerHTML = noticeView() + `<div class="card error">${esc(err.message)}</div>
        <button class="link" onclick="go('home')">← Back to home</button>`;
    }
}

async function pageView(user) {
    switch (state.view) {
        case 'home':         return feedView();
        case 'post':         return postView(user);
        case 'newPost':      return newPostView();
        case 'newCommunity': return newCommunityView();
        case 'profile':      return profileView(user);
    }
    return '';
}

// Login and register
function authView() {
    if (state.authMode === 'register') return `
    <div class="card">
    <h2 class="flush">Create an account</h2>
    <label for="regUsername">Username</label>
    <input type="text" id="regUsername" placeholder="3-32 lowercase letters, numbers, or _">
    <label for="regDisplayName">Display name</label>
    <input type="text" id="regDisplayName">
    <label for="regEmail">Email</label>
    <input type="email" id="regEmail">
    <label for="regPassword">Password</label>
    <input type="password" id="regPassword" placeholder="At least 8 characters">
    <div class="row top-gap">
    <button class="primary" onclick="submitRegister()">Register</button>
    <button class="link" onclick="setAuthMode('login')">Already have an account? Log in</button>
    </div>
    </div>`;
    return `
    <div class="card">
    <h2 class="flush">Log in</h2>
    <label for="loginName">Username or email</label>
    <input type="text" id="loginName">
    <label for="loginPassword">Password</label>
    <input type="password" id="loginPassword">
    <div class="row top-gap">
    <button class="primary" onclick="submitLogin()">Log in</button>
    <button class="link" onclick="setAuthMode('register')">Need an account? Register</button>
    </div>
    </div>`;
}

function setAuthMode(mode) {
    state.authMode = mode;
    render();
}

async function submitLogin() {
    try {
        state.user = await api.login($('loginName').value.trim(), $('loginPassword').value);
        go('home');
    } catch (err) { fail(err); }
}

async function submitRegister() {
    try {
        state.user = await api.register({
            username: $('regUsername').value.trim(),
            displayName: $('regDisplayName').value.trim(),
            email: $('regEmail').value.trim(),
            password: $('regPassword').value
        });
        go('home');
    } catch (err) { fail(err); }
}

async function logout() {
    try { await api.logout(); } catch (err) { state.notice = err.message; }
    state.user = null;
    state.communities = [];
    go('home');
}
// Feed Area
async function feedView() {
    const query = $('q').value.toLowerCase();
    const posts = (await api.listPosts(state.communityId))
    .filter((p) => (p.title + p.body).toLowerCase().includes(query));
    const c = state.communities.find((x) => x.id === state.communityId);
    const header = c
    ? `<div class="card">
    <h2 class="flush">c/${esc(c.name)}</h2>
    <p class="meta">${esc(c.desc || c.title)} · ${c.members} members</p>
    </div>`: '';
    return header + (posts.map((p) => postCard(p)).join('') || '<div class="empty">No posts yet.</div>');
}

const countComments = (comments) =>
    comments.reduce((n, c) => n + 1 + countComments(c.replies), 0);

function postCard(p, full = false) {
    const open = `go('post',{postId:${js(p.id)}})`;
    const comments = p.comments ? `${countComments(p.comments)} comments` : 'Comments';
    const body = full ? p.body : p.body.slice(0, 200);
    const link = p.externalUrl
    ? `<div><a href="${esc(p.externalUrl)}" target="_blank" rel="noopener noreferrer">${esc(p.externalUrl)}</a></div>` : '';
    return `
    <div class="card post">
    <div class="votes">${voteButtons(p, `vote(${js(p.id)},`)}</div>
    <div>
    <div class="meta">
    <span class="tag">c/${esc(communityName(p.communityId))}</span>
    u/${esc(p.author)} · ${timeAgo(p.created)}
    </div>
    <h2 onclick="${open}">${esc(p.title)}</h2>
    ${link}
    <div>${esc(body)}</div>
    <div class="meta">
    <button class="link" onclick="${open}">💬 ${comments}</button>
    </div>
    </div>
    </div>`;
}

function voteButtons(item, call) {
    return `
    <button class="${item.vote === 1 ? 'on' : ''}" onclick="${call}${item.vote === 1 ? 0 : 1})" aria-label="Upvote">▲</button>
    <b>${item.score}</b>
    <button class="${item.vote === -1 ? 'on' : ''}" onclick="${call}${item.vote === -1 ? 0 : -1})" aria-label="Downvote">▼</button>`;
}

async function vote(id, value) {
    try {
        await api.votePost(id, value);
        render();
    } catch (err) { fail(err); }
}

async function voteComment(commentId, value) {
    try {
        await api.voteComment(state.postId, commentId, value);
        render();
    } catch (err) { fail(err); }
}

// Post and comments
async function postView(user) {
    const p = await api.getPost(state.postId);
    const authorTools = p.author === user.name
    ? `<div class="card meta">
    <button class="link danger" onclick="removePost(${js(p.id)})">Delete post</button>
    </div>` : '';
    const comments = p.comments.map(commentView).join('') || '<div class="empty">Be the first to comment.</div>';
    return `
    <button class="link" onclick="go('home')">← Back</button>
    ${postCard(p, true)}
    ${authorTools}
    <div class="card">
    <label for="commentBody">Add a comment</label>
    <textarea id="commentBody"></textarea>
    <div class="row top-gap"><button class="primary" onclick="submitComment()">Comment</button></div>
    </div>
    <div class="card"><h3>Comments</h3>${comments}</div>`;
}

function commentView(c) {
    const replyForm = state.replyTo === c.id ? `
    <label for="replyBody">Reply to u/${esc(c.author)}</label>
    <textarea id="replyBody"></textarea>
    <div class="row top-gap">
    <button class="primary" onclick="submitComment(${js(c.id)})">Reply</button>
    <button onclick="setReplyTo(null)">Cancel</button>
    </div>` : '';
    return `<div class="comment">
    <div class="meta">u/${esc(c.author)} · ${timeAgo(c.created)}</div>
    ${esc(c.body)}
    ${c.deleted ? '' : `<div class="meta row">
    <span class="votes inline">${voteButtons(c, `voteComment(${js(c.id)},`)}</span>
    <button class="link" onclick="setReplyTo(${js(c.id)})">Reply</button>
    </div>`}
    ${replyForm}
    ${c.replies.map(commentView).join('')}
    </div>`;
}

function setReplyTo(commentId) {
    state.replyTo = commentId;
    render();
}

async function submitComment(parentId) {
    const body = $(parentId ? 'replyBody' : 'commentBody').value.trim();
    if (!body) return;
    try {
        await api.addComment(state.postId, body, parentId);
        state.replyTo = null;
        render();
    } catch (err) { fail(err); }
}

async function removePost(id) {
    if (!confirm('Delete this post? This can’t be undone.')) return;
    try {
        await api.deletePost(id);
        go('home');
    } catch (err) { fail(err); }
}

// Crreating the post
function newPostView() {
    if (!state.communities.length) return `
    <div class="card">
    <h2 class="flush">Create post</h2>
    <p class="meta">There are no communities to post in yet.</p>
    <button onclick="go('home')">Back</button>
    </div>`;
    const options = state.communities
    .map((c) => `<option value="${esc(c.id)}"${c.id === state.communityId ? ' selected' : ''}>c/${esc(c.name)}</option>`).join('');
    return `
    <div class="card">
    <h2 class="flush">Create post</h2>
    <label for="postCommunity">Community</label>
    <select id="postCommunity">${options}</select>
    <label for="postType">Type</label>
    <select id="postType" onchange="$('postUrlField').hidden = this.value !== 'link'">
    <option value="text">Text</option>
    <option value="link">Link</option>
    </select>
    <label for="postTitle">Title</label>
    <input type="text" id="postTitle">
    <div id="postUrlField" hidden>
    <label for="postUrl">Link URL</label>
    <input type="text" id="postUrl" placeholder="https://…">
    </div>
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
    if (!title) return fail(new Error('Title required'));
    const postType = $('postType').value;
    try {
        const post = await api.createPost({
            communityId: $('postCommunity').value,
            postType,
            title,
            body: $('postBody').value,
            externalUrl: postType === 'link' ? $('postUrl').value.trim() : undefined
        });
        go('post', { postId: post.id });
    } catch (err) { fail(err); }
}

// Creating a community
function newCommunityView() {
    return `
    <div class="card">
    <h2 class="flush">Create community</h2>
    <p class="meta">Creating communities isn't available yet.</p>
    <button onclick="go('home')">Back</button>
    </div>`;
}

// Profile page
function profileView(u) {
    return `
    <div class="card">
    <div class="row">
    <span class="avatar lg">${esc(u.name[0] || '?').toUpperCase()}</span>
    <div>
    <h2 class="flush">u/${esc(u.name)}</h2>
    <div class="meta">${esc(u.displayName)} · ${esc(u.email)}</div>
    </div>
    </div>
    <label for="profileName">Username</label>
    <input type="text" id="profileName" value="${esc(u.name)}" disabled>
    <label for="profileBio">Bio</label>
    <textarea id="profileBio" disabled>${esc(u.bio)}</textarea>
    <div class="row top-gap">
    <button class="primary" disabled>Save profile</button>
    <span class="meta">Profile editing coming soon.</span>
    </div>
    </div>`;
}
render();




