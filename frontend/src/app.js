const state = {
    view: 'home',        
    communityId: null,
    postId: null,
    communities: [],
    following: new Set(),
    user: null,
    authMode: 'login',
    notice: null,
    replyTo: null,
    commentDraft: '',
    replyDrafts: {},
    draftPostId: null,
    analyticsRange: '30d',
    analyticsPostId: null
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
    clearUploads();
    const next = { view, communityId: null, postId: null, replyTo: null, analyticsPostId: null, ...extra };
    const path = pathFor(next);
    if (location.pathname !== path) history.pushState({}, '', path);
    Object.assign(state, next);
    render();
}

function pathFor(next) {
    if (next.view === 'post' && next.postId) return `/posts/${encodeURIComponent(next.postId)}`;
    if (next.view === 'analytics' && next.analyticsPostId) return `/analytics/posts/${encodeURIComponent(next.analyticsPostId)}`;
    if (next.view === 'analytics') return '/analytics';
    if (next.view === 'profile') return '/profile';
    if (next.view === 'newPost') return '/posts/new';
    if (next.view === 'newCommunity') return '/communities/new';
    if (next.view === 'home' && next.communityId) return `/communities/${encodeURIComponent(next.communityId)}`;
    return '/';
}

function stateFromPath(pathname) {
    if (pathname === '/') return { view: 'home', communityId: null, postId: null };
    if (pathname === '/analytics') return { view: 'analytics', communityId: null, postId: null, analyticsPostId: null };
    if (pathname === '/profile') return { view: 'profile', communityId: null, postId: null };
    if (pathname === '/posts/new') return { view: 'newPost', communityId: null, postId: null };
    if (pathname === '/communities/new') return { view: 'newCommunity', communityId: null, postId: null };
    const post = /^\/posts\/([0-9A-HJKMNP-TV-Z]{12})$/i.exec(pathname);
    if (post) return { view: 'post', communityId: null, postId: post[1] };
    const analyticsPost = /^\/analytics\/posts\/([0-9A-HJKMNP-TV-Z]{12})$/i.exec(pathname);
    if (analyticsPost) return { view: 'analytics', communityId: null, postId: null, analyticsPostId: analyticsPost[1] };
    const community = /^\/communities\/([0-9a-f-]{36})$/i.exec(pathname);
    if (community) return { view: 'home', communityId: community[1], postId: null };
    return null;
}

function syncStateFromLocation() {
    const route = stateFromPath(location.pathname);
    if (!route) {
        history.replaceState({}, '', '/');
        Object.assign(state, { view: 'home', communityId: null, postId: null, replyTo: null });
        return;
    }
    Object.assign(state, route, { replyTo: null });
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
    $('newCommunityBtn').hidden = !loggedIn;

    if (!loggedIn) {
        state.user = null;
        shownPage = null;
        $('userBtn').textContent = 'Log in';
        $('nav').innerHTML = '';
        $('communities').innerHTML = '';
        $('creatorStudio').innerHTML = '<p class="meta">Log in to view creator analytics.</p>';
        main.innerHTML = noticeView() + authView();
        return;
    }

    $('nav').innerHTML =
    `<a class="navitem ${state.view === 'home' && !state.communityId ? 'active' : ''}" onclick="go('home')">Home</a>`;

    const page = [state.view, state.communityId, state.postId].join('|');
    if (page !== shownPage) main.innerHTML = '<div class="empty">Loading…</div>';

    try {
        if (!state.user) {
            [state.user, state.communities, state.following] =
                await Promise.all([api.getUser(), api.listCommunities(), api.listFollowing()]);
        }
        $('userBtn').textContent = 'u/' + state.user.name;
        $('communities').innerHTML = state.communities.map((c) =>
        `<a class="navitem ${state.communityId === c.id ? 'active' : ''}"
        onclick="go('home',{communityId:${js(c.id)}})">c/${esc(c.name)}</a>`
        ).join('') || '<p class="meta">No communities yet.</p>';
        const [html, creatorAnalytics] = await Promise.all([
            pageView(state.user),
            api.getCreatorAnalytics('30d')
        ]);
        if (current !== renderCount) return;
        shownPage = page;
        main.innerHTML = noticeView() + html;
        $('creatorStudio').innerHTML = creatorStudioView(creatorAnalytics);
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
        case 'analytics':    return analyticsView();
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
        await api.login($('loginName').value.trim(), $('loginPassword').value);
        state.user = null;
        render();
    } catch (err) { fail(err); }
}

async function submitRegister() {
    try {
        await api.register({
            username: $('regUsername').value.trim(),
            displayName: $('regDisplayName').value.trim(),
            email: $('regEmail').value.trim(),
            password: $('regPassword').value
        });
        state.user = null;
        render();
    } catch (err) { fail(err); }
}

async function logout() {
    try { await api.logout(); } catch (err) { state.notice = err.message; }
    state.user = null;
    state.communities = [];
    state.following = new Set();
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
    <div class="votes" data-post-vote="${esc(p.id)}" data-vote="${p.vote}">${voteButtons(p, `vote(${js(p.id)},`)}</div>
    <div>
    <div class="meta">
    <span class="tag">c/${esc(communityName(p.communityId))}</span>
    u/${esc(p.author)} ${followButton(p.authorId)}· ${timeAgo(p.created)}
    </div>
    <h2 onclick="${open}">${esc(p.title)}</h2>
    ${link}
    ${mediaView(p.media)}
    <div>${esc(body)}</div>
    <div class="meta">
    <button class="link" onclick="${open}">💬 ${comments}</button>
    </div>
    </div>
    </div>`;
}

// A post's images and videos, in display order. width/height let the browser reserve space before loading.
function mediaView(media) {
    if (!media || !media.length) return '';
    const items = media.map((m) => {
        const size = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
        return m.kind === 'video'
            ? `<video src="${esc(m.url)}"${size} controls playsinline preload="metadata"></video>`
            : `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(m.url)}"${size} alt="" loading="lazy"></a>`;
    }).join('');
    return `<div class="media-grid count-${media.length}">${items}</div>`;
}

function voteButtons(item, call) {
    return `
    <button class="up ${item.vote === 1 ? 'on' : ''}" onclick="${call}${item.vote === 1 ? 0 : 1})" aria-label="Upvote">▲</button>
    <b class="${item.vote === 1 ? 'up' : item.vote === -1 ? 'down' : ''}">${item.score}</b>
    <button class="down ${item.vote === -1 ? 'on' : ''}" onclick="${call}${item.vote === -1 ? 0 : -1})" aria-label="Downvote">▼</button>`;
}

function followButton(authorId) {
    if (!authorId || !state.user || authorId === state.user.id) return '';
    const on = state.following.has(authorId);
    return `· <button class="link follow ${on ? 'on' : ''}" onclick="toggleFollow(${js(authorId)})">${on ? 'Following' : 'Follow'}</button> `;
}

async function toggleFollow(userId) {
    try {
        if (state.following.has(userId)) {
            await api.unfollowUser(userId);
            state.following.delete(userId);
        } else {
            await api.followUser(userId);
            state.following.add(userId);
        }
        render();
    } catch (err) { fail(err); }
}

async function vote(id, value) {
    try {
        const summary = await api.votePost(id, value);
        document.querySelectorAll(`[data-post-vote="${id}"]`).forEach((container) =>
            updateVoteDisplay(container, summary, (next) => vote(id, next))
        );
    } catch (err) { fail(err); }
}

async function voteComment(commentId, value) {
    try {
        const summary = await api.voteComment(state.postId, commentId, value);
        document.querySelectorAll(`[data-comment-vote="${commentId}"]`).forEach((container) =>
            updateVoteDisplay(container, summary, (next) => voteComment(commentId, next))
        );
    } catch (err) { fail(err); }
}

function updateVoteDisplay(container, summary, submitVote) {
    const vote = summary.viewerVote ?? 0;
    const up = container.querySelector('button.up');
    const down = container.querySelector('button.down');
    const score = container.querySelector('b');
    container.dataset.vote = vote;
    up.classList.toggle('on', vote === 1);
    down.classList.toggle('on', vote === -1);
    score.classList.toggle('up', vote === 1);
    score.classList.toggle('down', vote === -1);
    score.textContent = summary.score;
    up.onclick = () => submitVote(vote === 1 ? 0 : 1);
    down.onclick = () => submitVote(vote === -1 ? 0 : -1);
}

// Post and comments
async function postView(user) {
    const p = await api.getPost(state.postId);
    if (state.draftPostId !== p.id) {
        state.draftPostId = p.id;
        state.commentDraft = '';
        state.replyDrafts = {};
    }
    api.recordPostView(state.postId).catch(() => {});
    const authorTools = p.author === user.name
    ? `<div class="card meta">
    <button class="link" onclick="go('analytics',{analyticsPostId:${js(p.id)}})">View post analytics</button>
    <button class="link danger" onclick="removePost(${js(p.id)})">Delete post</button>
    </div>` : '';
    const comments = p.comments.map(commentView).join('') || '<div class="empty">Be the first to comment.</div>';
    return `
    <button class="link" onclick="go('home')">← Back</button>
    ${postCard(p, true)}
    <div class="card meta"><button class="link" onclick="shareCurrentPost()">↗ Share post</button></div>
    ${authorTools}
    <div class="card">
    <label for="commentBody">Add a comment</label>
    <textarea id="commentBody" oninput="state.commentDraft=this.value">${esc(state.commentDraft)}</textarea>
    <div class="row top-gap"><button class="primary" onclick="submitComment()">Comment</button></div>
    </div>
    <div class="card"><h3>Comments</h3>${comments}</div>`;
}

function creatorStudioView(data) {
    const post = data.posts[0];
    if (!post) return '<p class="meta">Publish a post to start seeing analytics.</p>';
    return `<div class="studio-post-title">${esc(post.title)}</div>
      <div class="meta studio-period">Most recent post · last 30 days</div>
      <div class="studio-metrics">
        <div><strong>${post.views}</strong><span>Views</span></div>
        <div><strong class="up-text">${post.upvotes}</strong><span>Upvotes</span></div>
        <div><strong class="down-text">${post.downvotes}</strong><span>Downvotes</span></div>
        <div><strong>${post.shares}</strong><span>Shares</span></div>
        <div><strong>${post.score}</strong><span>Score</span></div>
      </div>`;
}

async function shareCurrentPost() {
    try {
        const url = `${location.origin}/posts/${encodeURIComponent(state.postId)}`;
        await navigator.clipboard?.writeText(url);
        await api.sharePost(state.postId);
        state.notice = 'Post link copied.';
        render();
    } catch (err) { fail(err); }
}

function analyticsChart(post) {
    const width = 720, height = 260, middle = 130, pad = 28;
    const max = Math.max(1, ...post.series.flatMap((p) => [p.upvotes, p.downvotes]));
    const scale = (middle - pad) / max;
    const groupWidth = (width - pad * 2) / post.series.length;
    const barWidth = Math.max(1, Math.min(9, groupWidth * .32));
    const bars = post.series.map((point, index) => {
      const center = pad + groupWidth * index + groupWidth / 2;
      const upHeight = point.upvotes * scale;
      const downHeight = point.downvotes * scale;
      return `<rect class="chart-up" x="${center-barWidth-1}" y="${middle-upHeight}" width="${barWidth}" height="${upHeight}"></rect>
        <rect class="chart-down" x="${center+1}" y="${middle}" width="${barWidth}" height="${downHeight}"></rect>`;
    }).join('');
    return `<div class="analytics-chart" role="img" aria-label="Upvotes above zero and downvotes below zero over time">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <line class="chart-axis" x1="${pad}" y1="${middle}" x2="${width-pad}" y2="${middle}"></line>
        ${bars}
      </svg>
      <div class="chart-legend"><span class="up-dot"></span> Upvotes <span class="down-dot"></span> Downvotes</div>
    </div>`;
}

async function analyticsView() {
    const data = await api.getCreatorAnalytics(state.analyticsRange);
    const selected = state.analyticsPostId
      ? data.posts.find((post) => post.id === state.analyticsPostId)
      : null;
    const cards = [
      ['Views', data.totals.views], ['Upvotes', data.totals.upvotes],
      ['Downvotes', data.totals.downvotes], ['Shares', data.totals.shares], ['Net score', data.totals.score]
    ].map(([label, value]) => `<div class="metric-card"><span>${esc(label)}</span><strong>${value}</strong></div>`).join('');
    const rows = data.posts.map((post) => `<tr class="${selected?.id === post.id ? 'selected' : ''}" onclick="selectAnalyticsPost(${js(post.id)})" title="View analytics for this post">
      <td><b>${esc(post.title)}</b><div class="meta">c/${esc(post.community)}</div></td>
      <td>${post.views}</td><td class="up-text">${post.upvotes}</td><td class="down-text">${post.downvotes}</td>
      <td>${post.shares}</td><td>${post.score}</td>
    </tr>`).join('');
    return `<section class="analytics-page">
      ${selected ? `<nav class="analytics-breadcrumb" aria-label="Analytics navigation">
        <button class="link" onclick="showAllAnalytics()">← All posts</button><span>/</span><span>${esc(selected.title)}</span>
      </nav>` : ''}
      <div class="analytics-heading"><div><h1>${selected ? 'Post analytics' : 'Creator analytics'}</h1><p class="meta">${selected ? esc(selected.title) : 'Performance for all your published posts'}</p></div>
        <select aria-label="Analytics date range" onchange="setAnalyticsRange(this.value)">
          ${['7d','30d','90d'].map((range) => `<option value="${range}"${range === state.analyticsRange ? ' selected' : ''}>Last ${range.slice(0,-1)} days</option>`).join('')}
        </select>
      </div>
      <div class="metric-grid">${cards}</div>
      ${selected ? `<div class="analytics-detail-actions row">
        <button onclick="showAllAnalytics()">← All posts analytics</button>
        <button onclick="go('post',{postId:${js(selected.id)}})">Open post</button>
      </div>
      <div class="card"><h2>Vote direction</h2><p class="meta">Daily vote totals: upvotes rise above zero and downvotes fall below it</p>${analyticsChart(selected)}</div>` : ''}
      <div class="card analytics-table-card"><h2>${selected ? 'Switch post' : 'Your posts'}</h2>
        ${rows ? `<div class="table-scroll"><table class="analytics-table"><thead><tr><th>Post</th><th>Views</th><th>Up</th><th>Down</th><th>Shares</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">Publish a post to start seeing analytics.</div>'}
      </div>
    </section>`;
}

function setAnalyticsRange(range) { state.analyticsRange = range; shownPage = null; render(); }
function showAllAnalytics() { go('analytics'); }
function selectAnalyticsPost(id) {
    state.analyticsPostId = id;
    history.pushState({}, '', `/analytics/posts/${encodeURIComponent(id)}`);
    shownPage = null;
    render();
}

function commentView(c) {
    const replyForm = state.replyTo === c.id ? `
    <label for="replyBody">Reply to u/${esc(c.author)}</label>
    <textarea id="replyBody" oninput="state.replyDrafts[${js(c.id)}]=this.value">${esc(state.replyDrafts[c.id] || '')}</textarea>
    <div class="row top-gap">
    <button class="primary" onclick="submitComment(${js(c.id)})">Reply</button>
    <button onclick="setReplyTo(null)">Cancel</button>
    </div>` : '';
    return `<div class="comment">
    <div class="meta">u/${esc(c.author)} ${c.deleted ? '' : followButton(c.authorId)}· ${timeAgo(c.created)}</div>
    ${esc(c.body)}
    ${c.deleted ? '' : `<div class="meta row">
    <span class="votes inline" data-comment-vote="${esc(c.id)}" data-vote="${c.vote}">${voteButtons(c, `voteComment(${js(c.id)},`)}</span>
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
        if (parentId) delete state.replyDrafts[parentId];
        else state.commentDraft = '';
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
    <select id="postType" onchange="setPostType(this.value)">
    <option value="text">Text</option>
    <option value="link">Link</option>
    <option value="media">Image / Video</option>
    </select>
    <label for="postTitle">Title</label>
    <input type="text" id="postTitle">
    <div id="postUrlField" hidden>
    <label for="postUrl">Link URL</label>
    <input type="text" id="postUrl" placeholder="https://…">
    </div>
    <div id="postMediaField" hidden>
    <label for="postFiles">Images and videos (up to ${MAX_UPLOADS})</label>
    <input type="file" id="postFiles" multiple accept="${UPLOAD_TYPES.join(',')}" onchange="addUploads(this)">
    <p class="meta">JPEG, PNG, GIF, or WebP up to 20 MB. MP4, WebM, or MOV up to 500 MB.</p>
    <div id="uploadList"></div>
    </div>
    <label for="postBody" id="postBodyLabel">Body</label>
    <textarea id="postBody"></textarea>
    <div id="postError" class="error top-gap" hidden></div>
    <div class="row top-gap">
    <button class="primary" onclick="submitPost()">Publish</button>
    <button onclick="go('home')">Cancel</button>
    </div>
    </div>`;
}

function setPostType(type) {
    $('postUrlField').hidden = type !== 'link';
    $('postMediaField').hidden = type !== 'media';
    $('postBodyLabel').textContent = type === 'text' ? 'Body' : 'Body (optional)';
}

// Shows a problem with the post form without re-rendering it, so what's been typed and uploaded stays.
function postFormError(message) {
    const el = $('postError');
    el.textContent = message || '';
    el.hidden = !message;
}

async function submitPost() {
    const title = $('postTitle').value.trim();
    if (!title) return postFormError('Title required');
    const postType = $('postType').value;
    let mediaIds;
    if (postType === 'media') {
        if (uploads.some((u) => u.status === 'uploading')) return postFormError('Wait for your uploads to finish.');
        mediaIds = uploads.filter((u) => u.status === 'ready').map((u) => u.media.id);
        if (!mediaIds.length) return postFormError('Add at least one image or video.');
    }
    postFormError(null);
    try {
        const post = await api.createPost({
            communityId: $('postCommunity').value,
            postType,
            title,
            body: $('postBody').value,
            externalUrl: postType === 'link' ? $('postUrl').value.trim() : undefined,
            mediaIds
        });
        go('post', { postId: post.id });
    } catch (err) {
        if (err.status === 401) return fail(err);
        postFormError(err.message);
    }
}

// Uploads for the post being written. Each starts as soon as it's picked, so the
// API's verdict (wrong type, too big, not really a video…) shows before publishing.
const MAX_UPLOADS = 4;
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
let uploads = [];
let uploadKey = 0;

function clearUploads() {
    for (const u of uploads) {
        u.controller.abort();
        URL.revokeObjectURL(u.preview);
    }
    uploads = [];
}

function addUploads(input) {
    const files = [...input.files];
    input.value = '';
    const room = MAX_UPLOADS - uploads.filter((u) => u.status !== 'failed').length;
    for (const [i, file] of files.entries()) {
        const u = {
            key: ++uploadKey,
            name: file.name,
            kind: file.type.startsWith('video/') ? 'video' : 'image',
            preview: URL.createObjectURL(file),
            controller: new AbortController(),
            progress: 0,
            status: 'uploading',
            error: null,
            media: null
        };
        uploads.push(u);
        if (i >= room) {
            u.status = 'failed';
            u.error = `A post can have at most ${MAX_UPLOADS} images or videos.`;
            continue;
        }
        startUpload(u, file);
    }
    renderUploads();
}

async function startUpload(u, file) {
    try {
        u.media = await api.uploadMedia(file, {
            signal: u.controller.signal,
            onProgress: (fraction) => {
                u.progress = fraction;
                const el = $('upload-status-' + u.key);
                if (el) el.innerHTML = uploadStatus(u);
            }
        });
        u.status = 'ready';
    } catch (err) {
        if (err.cancelled) return;
        u.status = 'failed';
        u.error = err.message;
    }
    renderUploads();
}

function removeUpload(key) {
    const u = uploads.find((x) => x.key === key);
    if (!u) return;
    u.controller.abort();
    URL.revokeObjectURL(u.preview);
    uploads = uploads.filter((x) => x !== u);
    renderUploads();
}

function uploadStatus(u) {
    if (u.status === 'ready') return '<span class="meta">Ready</span>';
    if (u.status === 'failed') return `<span class="error">${esc(u.error)}</span>`;
    if (u.progress < 1) return `<progress max="1" value="${u.progress}"></progress> <span class="meta">${Math.round(u.progress * 100)}%</span>`;
    return '<span class="meta">Checking file…</span>';
}

function renderUploads() {
    const list = $('uploadList');
    if (!list) return;
    list.innerHTML = uploads.map((u) => {
        const thumb = u.kind === 'video'
            ? `<video src="${esc(u.preview)}" muted preload="metadata"></video>`
            : `<img src="${esc(u.preview)}" alt="" onerror="this.style.visibility='hidden'">`;
        return `<div class="upload ${u.status}">
        ${thumb}
        <div class="upload-info">
        <div class="upload-name">${esc(u.name)}</div>
        <div id="upload-status-${u.key}">${uploadStatus(u)}</div>
        </div>
        <button class="link danger" onclick="removeUpload(${u.key})" aria-label="Remove ${esc(u.name)}">✕</button>
        </div>`;
    }).join('');
}

// Creating a community
function newCommunityView() {
    return `
    <div class="card">
    <h2 class="flush">Create community</h2>
    <label for="communitySlug">Name</label>
    <input type="text" id="communitySlug" placeholder="3-32 lowercase letters, numbers, or _">
    <label for="communityName">Display name</label>
    <input type="text" id="communityName" maxlength="100">
    <label for="communityDesc">Description</label>
    <textarea id="communityDesc" maxlength="1000" placeholder="Optional"></textarea>
    <div class="row top-gap">
    <button class="primary" onclick="submitCommunity()">Create</button>
    <button onclick="go('home')">Back</button>
    </div>
    </div>`;
}

async function submitCommunity() {
    try {
        const c = await api.createCommunity({
            slug: $('communitySlug').value.trim(),
            name: $('communityName').value.trim(),
            description: $('communityDesc').value.trim()
        });
        state.communities = await api.listCommunities();
        go('home', { communityId: c.id });
    } catch (err) { fail(err); }
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
syncStateFromLocation();
addEventListener('popstate', () => { syncStateFromLocation(); shownPage = null; render(); });
render();

