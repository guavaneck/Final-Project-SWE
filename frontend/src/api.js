const db = {
  user: {id: 1, name: 'Mod 1', bio: 'Bio placeholder.', joined: new Date().toISOString()},
  communities: [
    {id: 1, name: 'general',  desc: 'Post anything.', mods: ['Mod 1'], members: 120},
    {id: 2, name: 'creators', desc: 'Share your work.', mods: ['Mod 2'], members: 48}
  ],
  posts: [
    {
      id: 1, communityId: 1, author: 'Mod 2',
      title: 'Welcome to the forum!',
      body: 'Say hi!',
      score: 12, vote: 0, created: Date.now() - 36e5,
      comments: [{id: 1, author: 'Ryan', body: 'Hi!', created: Date.now() - 18e5}]
    },
    {
      id: 2, communityId: 2, author: 'Ryan',
      title: 'How does moderator voting work?',
      body: 'How?',
      score: -37, vote: 0, created: Date.now() - 72e5,
      comments: [{id: 2, author: "Satvik", body: 'idk', created: Date.now()}]
    }
  ],
  nextId: 100
};

const api = {
  // Users
  getUser:    async () => db.user,
  updateUser: async (changes) => Object.assign(db.user, changes),

  // Communities 
  listCommunities: async () => db.communities,
  createCommunity: async (c) => {
    const community = {id: db.nextId++, mods: [db.user.name], members: 1, ...c };
    db.communities.push(community);
    return community;
  },

  // Posts
  listPosts: async () => db.posts,
  getPost: async (id) => db.posts.find(p => p.id === id),
  createPost: async (p) => {
    const post = {
      id: db.nextId++, author: db.user.name, score: 0, vote: 0,
      created: Date.now(), comments: [], ...p
    };
    db.posts.unshift(post);
    return post;
  },
  votePost: async (id, value) => {
    const post = db.posts.find(p => p.id === id);
    post.score += value - post.vote;
    post.vote = value;
    return post;
  },

  deletePost: async (id) => {db.posts = db.posts.filter(p => p.id !== id);},

  // Comments
  addComment: async (postId, body) => {
    const comment = {id: db.nextId++, author: db.user.name, body, created: Date.now() };
    db.posts.find(p => p.id === postId).comments.push(comment);
    return comment;
  }
};
