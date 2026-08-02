import "./styles.css";
import md5 from "blueimp-md5";

type ApiResp<T = unknown> = {
  code: number;
  msg: string;
  data?: T;
};

type Id = string | number;

type Token = {
  token: string;
  expire: number;
};

type UserInfo = {
  uid?: Id;
  lark_id?: string;
  nickname?: string;
  firstname?: string;
  lastname?: string;
  gender?: number;
  avatar?: { avatar_small?: string; avatar_medium?: string; avatar_large?: string };
};

type AuthResp = {
  access_token?: Token;
  refresh_token?: Token;
  user_info?: UserInfo;
  server?: { server_id?: number; name?: string; port?: number };
};

type Conversation = {
  chat_id: Id;
  seq_id?: number;
  read_seq?: number;
  srv_ts?: number;
  title?: string;
  avatar?: string;
  chat_type?: number;
};

type Contact = {
  uid: Id;
  alias?: string;
  remark?: string;
  member_avatar?: string;
  status?: number;
};

type GroupChat = {
  chat_id: Id;
  chat_name?: string;
  remark?: string;
  chat_avatar?: string;
};

type ChatMessage = {
  srv_msg_id?: Id;
  cli_msg_id?: Id;
  sender_id?: Id;
  sender_name?: string;
  chat_id?: Id;
  chat_type?: number;
  seq_id?: number;
  msg_type?: number;
  body?: string;
  status?: number;
  sent_ts?: number;
  srv_ts?: number;
  alias?: string;
  member_avatar?: string;
};

type Invite = {
  invite_id?: Id;
  chat_id?: Id;
  chat_type?: number;
  initiator_uid?: Id;
  invitee_uid?: Id;
  invitation_msg?: string;
  handle_result?: number;
  handle_msg?: string;
  created_ts?: number;
  initiator_info?: UserSummary;
};

type UserSummary = {
  uid?: Id;
  lark_id?: string;
  nickname?: string;
  avatar?: string;
  gender?: number;
  status?: number;
};

type ChatMember = {
  uid?: Id;
  alias?: string;
  member_avatar?: string;
  role_id?: number;
  status?: number;
  read_seq?: number;
};

type MessageSummary = {
  srv_msg_id?: Id;
  cli_msg_id?: Id;
  sender_id?: Id;
  chat_id?: Id;
  seq_id?: number;
  rt?: string;
  body?: string;
  srv_ts?: number;
  sent_ts?: number;
};

type Pane = "conversations" | "contacts" | "groups" | "invites";
type Drawer = "profile" | "location" | "red" | "members" | "group" | "search" | null;

const storageKeys = {
  token: "lark.jwt",
  refreshToken: "lark.refresh_token",
  user: "lark.user",
  currentChat: "lark.current_chat"
};

const state = {
  booted: false,
  busy: false,
  pane: "conversations" as Pane,
  user: readJson<UserInfo>(storageKeys.user),
  conversations: [] as Conversation[],
  contacts: [] as Contact[],
  groups: [] as GroupChat[],
  invites: [] as Invite[],
  outgoingInvites: [] as Invite[],
  messages: [] as ChatMessage[],
  members: [] as ChatMember[],
  chatMembersById: {} as Record<string, ChatMember[]>,
  usersById: {} as Record<string, UserInfo | UserSummary>,
  userResults: [] as UserSummary[],
  userList: [] as UserInfo[],
  messageResults: [] as MessageSummary[],
  groupDetails: null as any,
  financeResult: "",
  redResult: "",
  pushStatus: "未连接",
  currentChat: readJson<Conversation>(storageKeys.currentChat),
  drawer: null as Drawer,
  notice: "",
  error: "",
  ws: null as WebSocket | null,
  loginMode: "signin" as "signin" | "signup"
};

const appNode = document.querySelector<HTMLDivElement>("#app");

if (!appNode) {
  throw new Error("Missing #app mount node");
}

const app = appNode;

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function token() {
  return localStorage.getItem(storageKeys.token) || "";
}

function setToken(value: string) {
  const clean = value.replace(/^Bearer\s+/i, "").replace(/^jwt=/i, "").trim();
  localStorage.setItem(storageKeys.token, clean);
  document.cookie = `jwt=${clean}; path=/; SameSite=Lax`;
}

function clearToken() {
  localStorage.removeItem(storageKeys.token);
  localStorage.removeItem(storageKeys.refreshToken);
  localStorage.removeItem(storageKeys.user);
  localStorage.removeItem(storageKeys.currentChat);
  document.cookie = "jwt=; Max-Age=0; path=/";
}

async function api<T>(path: string, options: RequestInit = {}): Promise<ApiResp<T>> {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    return { code: response.ok ? 0 : response.status, msg: text };
  }
  return parseApiJson<ApiResp<T>>(text);
}

function parseApiJson<T>(text: string): T {
  return JSON.parse(quoteLargeIntegers(text)) as T;
}

function quoteLargeIntegers(text: string) {
  let out = "";
  let i = 0;
  let inString = false;
  let escaped = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if ((ch === "-" && /\d/.test(text[i + 1] || "")) || /\d/.test(ch)) {
      const start = i;
      if (ch === "-") i += 1;
      while (/\d/.test(text[i] || "")) i += 1;
      let hasFraction = false;
      if (text[i] === "." || text[i] === "e" || text[i] === "E") {
        hasFraction = true;
        while (/[0-9eE+\-.]/.test(text[i] || "")) i += 1;
      }
      const num = text.slice(start, i);
      const digits = num.replace("-", "");
      out += !hasFraction && digits.length >= 16 ? `"${num}"` : num;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const rawNumericBodyKeys = new Set([
  "chat_id",
  "uid",
  "uid_list",
  "invite_id",
  "invitee_uid",
  "invitee_uids",
  "initiator_uid",
  "handler_uid",
  "contact_id",
  "member_list",
  "receiver_uid",
  "receiver_uids",
  "sender_uid",
  "env_id",
  "srv_msg_id",
  "cli_msg_id"
]);

function jsonBody(value: unknown) {
  return stringifyForApi(value);
}

function stringifyForApi(value: unknown, key = ""): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    return rawNumericBodyKeys.has(key) && /^-?\d{16,}$/.test(value) ? value : JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyForApi(item, key)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([itemKey, item]) => `${JSON.stringify(itemKey)}:${stringifyForApi(item, itemKey)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function query(params: Record<string, string | number | boolean | Id | undefined>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "" || value === false) return;
    qs.set(key, String(value));
  });
  const out = qs.toString();
  return out ? `?${out}` : "";
}

function idText(value?: Id | null) {
  return value === undefined || value === null ? "" : String(value);
}

function sameId(a?: Id | null, b?: Id | null) {
  return idText(a) === idText(b);
}

function currentUserId() {
  return idText(state.user?.uid);
}

function setNotice(message: string) {
  state.notice = message;
  state.error = "";
  render();
}

function setError(message: string) {
  state.error = message;
  state.notice = "";
  render();
}

async function bootstrap() {
  if (!token()) {
    state.booted = true;
    render();
    return;
  }
  state.booted = true;
  render();
  await refreshAll();
  connectWs();
}

async function refreshAll() {
  state.busy = true;
  render();
  await loadMe();
  await Promise.allSettled([loadContacts(), loadGroups(), loadInvites()]);
  await loadConversations();
  state.busy = false;
  render();
}

async function loadMe() {
  const res = await api<{ user_info?: UserInfo }>(`/api/user/user_info${query({ is_self: true })}`);
  const info = (res.data as any)?.user_info || res.data;
  if (res.code === 0 && info) {
    state.user = info;
    saveJson(storageKeys.user, state.user);
  }
}

async function loadConversations() {
  const res = await api<Conversation[]>(
    `/api/convo/chat_seq_list${query({ last_cid: 0, last_ts: Math.floor(Date.now() / 1000) + 60, limit: 50 })}`
  );
  if (res.code !== 0) return setError(res.msg || "会话加载失败");
  state.conversations = await Promise.all(normalizeArray(res.data).map(enrichConversation));
  if (state.currentChat) {
    const latest = state.conversations.find((item) => sameId(item.chat_id, state.currentChat?.chat_id));
    if (latest) state.currentChat = { ...state.currentChat, ...latest };
  }
  if (!state.currentChat && state.conversations[0]) await selectConversation(state.conversations[0], false);
}

async function loadContacts() {
  const res = await api<Contact[]>(`/api/chat_member/contact_list${query({ limit: 50, last_chat_id: 0 })}`);
  if (res.code === 0) {
    state.contacts = normalizeArray(res.data);
    await ensureUsersByIds(state.contacts.map((item) => item.uid));
  }
}

async function loadGroups() {
  const res = await api<GroupChat[]>(`/api/chat_member/group_chat_list${query({ limit: 50, last_chat_id: 0 })}`);
  if (res.code === 0) state.groups = normalizeArray(res.data);
}

async function loadInvites() {
  const [incoming, outgoing] = await Promise.all([
    api<Invite[]>(`/api/chat_invite/list${query({ role: 2, max_invite_id: 0, handle_result: 0, limit: 20 })}`),
    api<Invite[]>(`/api/chat_invite/list${query({ role: 1, max_invite_id: 0, limit: 20 })}`)
  ]);
  if (incoming.code === 0) state.invites = normalizeArray(incoming.data);
  if (outgoing.code === 0) state.outgoingInvites = normalizeArray(outgoing.data);
  await ensureUsersByIds([...state.invites, ...state.outgoingInvites].flatMap((item) => [item.initiator_uid, item.invitee_uid]));
}

function normalizeArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function listFrom<T>(value: any): T[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.list)) return value.list;
  return [];
}

async function enrichConversation(item: Conversation): Promise<Conversation> {
  const group = state.groups.find((groupItem) => sameId(groupItem.chat_id, item.chat_id));
  if (group) {
    return {
      ...item,
      chat_type: 2,
      title: group.chat_name || group.remark || "群聊",
      avatar: group.chat_avatar || item.avatar
    };
  }

  const members = await getMembersForChat(item.chat_id);
  const other = members.find((member) => !sameId(member.uid, state.user?.uid));
  if (!other?.uid) {
    return { ...item, title: item.title || "聊天" };
  }
  await ensureUsersByIds([other.uid]);
  return {
    ...item,
    chat_type: 1,
    title: displayUserName(other.uid, other.alias || "好友"),
    avatar: other.member_avatar || item.avatar
  };
}

function labelForChat(chatId: Id) {
  const group = state.groups.find((item) => sameId(item.chat_id, chatId));
  if (group) return group.chat_name || group.remark || `群聊 ${chatId}`;
  return `会话 ${chatId}`;
}

async function ensureUsersByIds(ids: Array<Id | undefined | null>) {
  const pending = Array.from(new Set(ids.map(idText).filter(Boolean))).filter((uid) => !state.usersById[uid]);
  if (!pending.length) return;
  const res = await api<{ list?: UserInfo[] }>(`/api/user/list${query({ uids: pending.join(",") })}`);
  if (res.code !== 0) return;
  listFrom<UserInfo>(res.data).forEach((item) => {
    if (item.uid) state.usersById[idText(item.uid)] = item;
  });
}

function userById(uid?: Id | null) {
  return state.usersById[idText(uid)];
}

function displayUserName(uid?: Id | null, fallback = "好友") {
  const contact = state.contacts.find((item) => sameId(item.uid, uid));
  const user = userById(uid);
  return contact?.alias || contact?.remark || user?.nickname || user?.lark_id || fallback;
}

function displayUserSubtitle(uid?: Id | null) {
  const user = userById(uid);
  if (user?.lark_id) return `Lark ID ${user.lark_id}`;
  return "Lark 用户";
}

async function getMembersForChat(chatId: Id, force = false) {
  const key = idText(chatId);
  if (!force && state.chatMembersById[key]) return state.chatMembersById[key];
  const res = await api<{ list?: ChatMember[] }>(`/api/chat_member/list${query({ chat_id: key, limit: 100, last_uid: 0 })}`);
  if (res.code !== 0) return [];
  const members = listFrom<ChatMember>(res.data);
  state.chatMembersById[key] = members;
  await ensureUsersByIds(members.map((item) => item.uid));
  return members;
}

async function selectConversation(convo: Conversation, shouldRender = true) {
  state.currentChat = { ...convo, title: convo.title || labelForChat(convo.chat_id) };
  state.drawer = null;
  state.members = [];
  state.messageResults = [];
  state.groupDetails = null;
  saveJson(storageKeys.currentChat, state.currentChat);
  if (shouldRender) render();
  await loadMessages();
}

async function openGroup(group: GroupChat) {
  await selectConversation({
    chat_id: group.chat_id,
    title: group.chat_name || group.remark || "群聊",
    avatar: group.chat_avatar,
    chat_type: 2
  });
}

async function openContact(uid: Id) {
  await loadConversations();
  const existing = await findPrivateConversation(uid);
  if (!existing) {
    setError("还没有可打开的私聊。请先发送好友申请，等对方同意后再刷新。");
    return;
  }
  state.pane = "conversations";
  await selectConversation(existing);
}

async function findPrivateConversation(uid: Id) {
  const groupIds = new Set(state.groups.map((item) => idText(item.chat_id)));
  for (const convo of state.conversations) {
    if (groupIds.has(idText(convo.chat_id)) || convo.chat_type === 2) continue;
    const members = await getMembersForChat(convo.chat_id);
    if (members.some((member) => sameId(member.uid, uid))) {
      return {
        ...convo,
        chat_type: 1,
        title: displayUserName(uid, "好友")
      };
    }
  }
  return null;
}

async function loadMessages() {
  if (!state.currentChat?.chat_id) return;
  const seq = Number(state.currentChat.seq_id || 0);
  if (!seq) {
    state.messages = [];
    render();
    return;
  }
  const seqIds = Array.from({ length: Math.min(seq, 30) }, (_, i) => seq - i).reverse().join(",");
  const res = await api<{ list?: ChatMessage[]; last_seq_id?: number }>(
    `/api/chat_msg/list${query({ chat_id: state.currentChat.chat_id, seq_ids: seqIds, order: 0 })}`
  );
  if (res.code === 0) {
    const payload = res.data as any;
    state.messages = normalizeArray(payload?.list || payload?.msgs?.list);
    render();
  }
}

async function loadChatMembers() {
  if (!state.currentChat?.chat_id) return setError("请选择一个会话");
  const members = await getMembersForChat(state.currentChat.chat_id, true);
  state.members = members;
  render();
}

async function loadGroupDetails() {
  const chatId = state.currentChat?.chat_id;
  if (!chatId || !currentChatIsGroup()) return setError("请选择一个群聊");
  const res = await api<any>(`/api/chat/group_chat_details${query({ chat_id: chatId })}`);
  if (res.code !== 0) return setError(res.msg || "群详情加载失败");
  state.groupDetails = res.data || {};
  setNotice("群详情已同步");
}

async function sendMessage() {
  const input = document.querySelector<HTMLTextAreaElement>("#messageInput");
  const body = input?.value.trim() || "";
  if (!state.currentChat?.chat_id) return setError("请选择一个会话");
  if (!body) return;

  const optimistic: ChatMessage = {
    chat_id: state.currentChat.chat_id,
    sender_id: state.user?.uid,
    sender_name: state.user?.nickname || "我",
    body,
    msg_type: 1,
    sent_ts: Date.now()
  };
  state.messages = [...state.messages, optimistic];
  if (input) input.value = "";
  render();

  const res = await api("/api/chat_msg/send_msg", {
    method: "POST",
    body: jsonBody({ chat_id: state.currentChat.chat_id, body, msg_type: 1 })
  });
  if (res.code !== 0) return setError(res.msg || "发送失败");
  setNotice("消息已发送");
  setTimeout(loadConversations, 400);
}

async function searchMessages() {
  if (!state.currentChat?.chat_id) return setError("请选择一个会话");
  const keyword = value("#messageSearch");
  if (!keyword) return setError("请输入消息关键词");
  const res = await api<{ total?: number; list?: MessageSummary[] }>(
    `/api/chat_msg/search${query({ chat_id: state.currentChat.chat_id, query: keyword, size: 10, last_msg_id: 0 })}`
  );
  if (res.code !== 0) return setError(res.msg || "消息搜索失败");
  state.messageResults = listFrom<MessageSummary>(res.data);
  render();
}

async function operateMessage() {
  if (!state.currentChat?.chat_id) return setError("请选择一个会话");
  const seqId = Number(value("#messageOpSeq"));
  const opn = Number(value("#messageOpn") || 1);
  if (!seqId) return setError("请输入消息 Seq ID");
  const res = await api("/api/chat_msg/operation", {
    method: "POST",
    body: jsonBody({ chat_id: state.currentChat.chat_id, seq_id: seqId, opn })
  });
  if (res.code !== 0) return setError(res.msg || "消息操作失败");
  setNotice("消息操作已提交");
  await loadMessages();
}

async function signIn() {
  const account = value("#signinAccount");
  const password = normalizePassword(value("#signinPassword"));
  const res = await api<AuthResp>("/open/auth/sign_in", {
    method: "POST",
    body: jsonBody({
      account_type: Number(value("#signinType") || 1),
      platform: Number(value("#signinPlatform") || 5),
      account,
      udid: value("#signinUdid") || defaultUdid(),
      password
    })
  });
  if (res.code !== 0 || !res.data?.access_token?.token) return setError(res.msg || "登录失败");
  persistAuth(res.data);
  await refreshAll();
  connectWs();
  setNotice("登录成功");
}

async function signUp() {
  const res = await api<AuthResp>("/open/auth/sign_up", {
    method: "POST",
    body: jsonBody({
      reg_platform: 5,
      nickname: value("#signupNickname"),
      password: normalizePassword(value("#signupPassword")),
      firstname: value("#signupFirstname") || "Lark",
      lastname: value("#signupLastname") || "User",
      gender: Number(value("#signupGender") || 0),
      mobile: value("#signupMobile"),
      email: value("#signupEmail"),
      city_id: 0,
      udid: value("#signupUdid") || defaultUdid()
    })
  });
  if (res.code !== 0) return setError(res.msg || "注册失败");
  state.loginMode = "signin";
  setNotice("注册成功，请登录");
}

function persistAuth(data: AuthResp) {
  if (data.access_token?.token) setToken(data.access_token.token);
  if (data.refresh_token?.token) localStorage.setItem(storageKeys.refreshToken, data.refresh_token.token);
  if (data.user_info) {
    state.user = data.user_info;
    saveJson(storageKeys.user, data.user_info);
  }
}

async function signOut() {
  await api("/api/auth/sign_out", { method: "POST", body: jsonBody({}) });
  clearToken();
  state.user = null;
  state.currentChat = null;
  state.conversations = [];
  state.contacts = [];
  state.groups = [];
  state.messages = [];
  state.invites = [];
  state.outgoingInvites = [];
  state.members = [];
  state.chatMembersById = {};
  state.usersById = {};
  state.userResults = [];
  state.userList = [];
  closeWs();
  render();
}

async function createGroup() {
  const name = value("#groupName");
  if (!name) return setError("请输入群名称");
  const members = await resolveUserIds(value("#groupMembers"));
  if (!members) return;
  const res = await api("/api/chat/create_group_chat", {
    method: "POST",
    body: jsonBody({
      name,
      about: value("#groupAbout"),
      uid_list: members
    })
  });
  if (res.code !== 0) return setError(res.msg || "建群失败");
  setNotice(members.length ? "群聊已创建，成员会收到入群邀请" : "群聊已创建");
  await loadGroups();
  await loadConversations();
  const created = [...state.groups].reverse().find((item) => item.chat_name === name);
  if (created) await openGroup(created);
}

async function inviteUser(chatType = 1, uids?: Id[]) {
  const invitee = uids?.length ? uids : await resolveUserIds(value("#inviteUids"));
  if (!invitee) return;
  if (!invitee.length) return setError(chatType === 1 ? "请选择或输入要添加的用户" : "请输入要邀请的成员");
  const chatId = chatType === 1 ? 0 : state.currentChat?.chat_id || 0;
  if (chatType === 2 && !currentChatIsGroup()) return setError("请先打开一个群聊");
  const res = await api("/api/chat_invite/initiate", {
    method: "POST",
    body: jsonBody({
      chat_id: chatId,
      chat_type: chatType,
      invitee_uids: invitee,
      invitation_msg: value("#inviteMessage") || "一起聊聊"
    })
  });
  if (res.code !== 0) return setError(res.msg || "邀请失败");
  setNotice(chatType === 1 ? "好友申请已发送，等待对方同意" : "入群邀请已发送，等待对方同意");
  await loadInvites();
}

async function inviteCurrentGroup() {
  if (!currentChatIsGroup()) return setError("请先打开一个群聊");
  const ids = await resolveUserIds(value("#memberInviteQuery"));
  if (!ids) return;
  if (!ids.length) return setError("请输入要邀请的成员");
  await inviteUser(2, ids);
}

async function inviteDirect() {
  const ids = await resolveUserIds(value("#userQuery"));
  if (!ids) return;
  if (ids.length !== 1) return setError("一次只能向一个用户发送好友申请");
  await inviteUser(1, ids);
}

async function resolveUserIds(input: string) {
  const parts = input.split(/[,\s，、]+/).map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return [] as Id[];
  const ids: Id[] = [];
  for (const part of parts) {
    if (/^\d{16,}$/.test(part)) {
      ids.push(part);
      continue;
    }
    const res = await api<{ total?: number; list?: UserSummary[] }>(
      `/api/user/search${query({ query: part, size: 10, last_uid: 0 })}`
    );
    if (res.code !== 0) {
      setError(res.msg || `查找 ${part} 失败`);
      return null;
    }
    const list = listFrom<UserSummary>(res.data).filter((item) => !sameId(item.uid, state.user?.uid));
    if (!list.length) {
      setError(`没有找到 ${part}`);
      return null;
    }
    if (list.length > 1) {
      state.userResults = list;
      state.pane = "contacts";
      render();
      setNotice(`${part} 匹配到多个人，请从通讯录搜索结果里选择`);
      return null;
    }
    if (list[0].uid) {
      state.usersById[idText(list[0].uid)] = list[0];
      ids.push(idText(list[0].uid));
    }
  }
  return Array.from(new Set(ids.map(idText))).filter((id) => id && id !== currentUserId());
}

async function searchUsers() {
  const keyword = value("#userQuery");
  if (!keyword) return setError("请输入用户关键词");
  const res = await api<{ total?: number; list?: UserSummary[] }>(
    `/api/user/search${query({ query: keyword, size: 10, last_uid: 0 })}`
  );
  if (res.code !== 0) return setError(res.msg || "用户搜索失败");
  state.userResults = listFrom<UserSummary>(res.data);
  state.userResults.forEach((item) => {
    if (item.uid) state.usersById[idText(item.uid)] = item;
  });
  if (!state.userResults.length) return setNotice("没有找到匹配用户");
  render();
}

async function lookupUsers() {
  const uids = value("#userUids");
  if (!uids) return setError("请输入用户列表");
  const res = await api<{ list?: UserInfo[] }>(`/api/user/list${query({ uids })}`);
  if (res.code !== 0) return setError(res.msg || "用户列表查询失败");
  state.userList = listFrom<UserInfo>(res.data);
  render();
}

async function editGroup() {
  const chatId = state.currentChat?.chat_id;
  if (!chatId || !currentChatIsGroup()) return setError("请选择一个群聊");
  const str_list = [
    { key: "name", value: value("#editGroupName") },
    { key: "about", value: value("#editGroupAbout") }
  ].filter((item) => item.value);
  if (!str_list.length) return setError("请输入要修改的群名称或简介");
  const res = await api("/api/chat/edit_group_chat", {
    method: "POST",
    body: jsonBody({ chat_id: chatId, kvs: { str_list } })
  });
  if (res.code !== 0) return setError(res.msg || "群资料更新失败");
  setNotice("群资料已更新");
  await Promise.all([loadGroups(), loadConversations(), loadGroupDetails()]);
}

async function removeGroupMembers() {
  const chatId = state.currentChat?.chat_id;
  if (!chatId || !currentChatIsGroup()) return setError("请选择一个群聊");
  const members = await resolveUserIds(value("#removeMembers"));
  if (!members) return;
  if (!members.length) return setError("请输入要移除的成员");
  const res = await api("/api/chat/remove_group_member", {
    method: "POST",
    body: jsonBody({ chat_id: chatId, member_list: members })
  });
  if (res.code !== 0) return setError(res.msg || "移除成员失败");
  setNotice("成员已移除");
  await loadChatMembers();
}

async function quitGroup() {
  const chatId = state.currentChat?.chat_id;
  if (!chatId || !currentChatIsGroup()) return setError("请选择一个群聊");
  const res = await api("/api/chat/quit_group_chat", {
    method: "POST",
    body: jsonBody({ chat_id: chatId })
  });
  if (res.code !== 0) return setError(res.msg || "退群失败");
  state.currentChat = null;
  localStorage.removeItem(storageKeys.currentChat);
  setNotice("已退出群聊");
  await Promise.all([loadGroups(), loadConversations()]);
}

async function deleteContact() {
  const contactId = value("#deleteContactUid");
  const chatId = value("#deleteContactChatId") || idText(state.currentChat?.chat_id);
  if (!chatId || !contactId) return setError("请选择联系人和私聊会话");
  const res = await api("/api/chat/delete_contact", {
    method: "POST",
    body: jsonBody({ chat_id: chatId, contact_id: contactId })
  });
  if (res.code !== 0) return setError(res.msg || "删除联系人失败");
  setNotice("联系人已删除");
  await Promise.all([loadContacts(), loadConversations()]);
}

async function handleInvite(inviteId: Id, result: 1 | 2) {
  const res = await api("/api/chat_invite/handle", {
    method: "POST",
    body: jsonBody({ invite_id: inviteId, handle_result: result, handle_msg: result === 1 ? "同意" : "拒绝" })
  });
  if (res.code !== 0) return setError(res.msg || "处理失败");
  setNotice("邀请已处理");
  await Promise.all([loadInvites(), loadContacts(), loadGroups(), loadConversations()]);
}

async function updateProfile() {
  const nickname = value("#profileNickname");
  const res = await api("/api/user/edit_info", {
    method: "POST",
    body: jsonBody({ kvs: { str_list: [{ key: "nickname", value: nickname }] } })
  });
  if (res.code !== 0) return setError(res.msg || "资料更新失败");
  setNotice("资料已更新");
  await loadMe();
}

async function reportLocation() {
  const res = await api("/api/lbs/report_lng_lat", {
    method: "POST",
    body: jsonBody({ longitude: Number(value("#lng") || 116.397128), latitude: Number(value("#lat") || 39.916527) })
  });
  if (res.code !== 0) return setError(res.msg || "位置上报失败");
  setNotice("位置已上报");
}

async function peopleNearby() {
  const res = await api<any[]>(`/api/lbs/people_nearby${query({
    longitude: Number(value("#lng") || 116.397128),
    latitude: Number(value("#lat") || 39.916527),
    radius: 5000,
    gender: 0,
    min_age: 0,
    max_age: 99,
    limit: 20,
    skip: 0,
    last_uid: 0
  })}`);
  if (res.code !== 0) return setError(res.msg || "附近的人加载失败");
  setNotice(`附近的人：${normalizeArray(res.data).length} 个`);
}

async function giveRedEnvelope() {
  if (!state.currentChat?.chat_id) return setError("请选择一个会话");
  const receiverInput = value("#redReceivers");
  const receiverUids = receiverInput ? await resolveUserIds(receiverInput) : [];
  if (!receiverUids) return;
  const res = await api("/api/red_env/give", {
    method: "POST",
    body: jsonBody({
      env_type: 1,
      receiver_type: 1,
      chat_id: state.currentChat.chat_id,
      sender_uid: state.user?.uid || 0,
      total: Number(value("#redAmount") || 100),
      quantity: Number(value("#redQuantity") || 1),
      message: value("#redMessage") || "恭喜发财",
      receiver_uids: receiverUids,
      sender_platform: 5,
      pay_password: value("#payPassword")
    })
  });
  if (res.code !== 0) return setError(res.msg || "红包发送失败");
  setNotice("红包已发送");
}

async function grabRedEnvelope() {
  const envId = value("#redEnvId");
  if (!envId) return setError("请输入红包 ID");
  const res = await api<any>("/api/red_env_receive/grab", {
    method: "POST",
    body: jsonBody({ env_id: envId, uid: state.user?.uid || 0 })
  });
  if (res.code !== 0) return setError(res.msg || "抢红包失败");
  state.redResult = `抢红包结果：${JSON.stringify(res.data || {})}`;
  setNotice("抢红包完成");
}

async function openRedEnvelope() {
  const envId = value("#redEnvId");
  if (!envId) return setError("请输入红包 ID");
  const res = await api<any>("/api/red_env_receive/open", {
    method: "POST",
    body: jsonBody({ env_id: envId, uid: state.user?.uid || 0 })
  });
  if (res.code !== 0) return setError(res.msg || "拆红包失败");
  state.redResult = `拆红包结果：${JSON.stringify(res.data || {})}`;
  setNotice("拆红包完成");
}

async function createRedOrder() {
  const envId = value("#redEnvId");
  const amount = Number(value("#redAmount") || 100);
  if (!envId) return setError("请输入红包 ID");
  const res = await api<string>("/api/order/create_red_rnv", {
    method: "POST",
    body: jsonBody({ env_id: envId, amount, platform: 5, pay_type: Number(value("#payType") || 1), uid: state.user?.uid || 0 })
  });
  if (res.code !== 0) return setError(res.msg || "红包订单创建失败");
  state.financeResult = `支付链接：${res.data || "后端未返回链接"}`;
  setNotice("红包订单已创建");
}

async function queryFinance(kind: "order" | "payment") {
  const path = kind === "order" ? "/api/order/info" : "/api/payment/info";
  const res = await api<any>(path);
  if (res.code !== 0) return setError(res.msg || "查询失败");
  state.financeResult = `${kind === "order" ? "订单" : "支付"}信息：${JSON.stringify(res.data || "后端占位接口")}`;
  setNotice("查询完成");
}

async function openDrawer(drawer: Drawer) {
  state.drawer = drawer;
  render();
  if (drawer === "members") await loadChatMembers();
  if (drawer === "group" && currentChatIsGroup()) await loadGroupDetails();
}

function connectWs() {
  if (!token()) return;
  if (state.ws && state.ws.readyState <= WebSocket.OPEN) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/socket`);
  ws.binaryType = "arraybuffer";
  state.ws = ws;
  state.pushStatus = "正在连接推送";
  render();
  ws.addEventListener("open", () => {
    state.pushStatus = "推送已连接";
    state.notice = "推送通道已建立";
    render();
  });
  ws.addEventListener("message", (event) => handlePush(event.data));
  ws.addEventListener("close", () => {
    state.ws = null;
    state.pushStatus = "推送已断开";
    render();
  });
  ws.addEventListener("error", () => {
    state.pushStatus = "推送连接异常";
    render();
  });
}

function closeWs() {
  if (state.ws && state.ws.readyState <= WebSocket.OPEN) state.ws.close();
  state.ws = null;
  state.pushStatus = "未连接";
}

async function handlePush(data: unknown) {
  const packet = decodePushHeader(data);
  if (!packet) {
    state.pushStatus = "收到推送";
    await refreshAll();
    return;
  }
  state.pushStatus = pushLabel(packet.topic, packet.subtopic);
  if (packet.topic === 1 && packet.subtopic === 1000) {
    await Promise.all([loadConversations(), loadMessages()]);
    return;
  }
  if (packet.topic === 3 || packet.subtopic === 2000) {
    await Promise.all([loadInvites(), loadConversations()]);
    return;
  }
  if (packet.topic === 4 || packet.subtopic === 3000 || packet.subtopic === 3001) {
    await Promise.all([loadConversations(), loadMessages()]);
    return;
  }
  await loadConversations();
}

function decodePushHeader(data: unknown) {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 16) return null;
  const view = new DataView(data);
  return {
    length: view.getInt32(0, true),
    topic: view.getInt32(4, true),
    subtopic: view.getInt32(8, true),
    msgType: view.getInt32(12, true)
  };
}

function pushLabel(topic: number, subtopic: number) {
  if (topic === 1 && subtopic === 1000) return "收到新消息";
  if (topic === 3 || subtopic === 2000) return "收到邀请通知";
  if (topic === 4 || subtopic === 3000 || subtopic === 3001) return "收到红包通知";
  return "收到推送";
}

function defaultUdid() {
  return "0123456789012345678901234567890123456789";
}

function normalizePassword(input: string) {
  return /^[a-f0-9]{32}$/i.test(input) ? input.toLowerCase() : md5(input);
}

function value(selector: string) {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value.trim() || "";
}

function html(value?: string | number | Id) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initials(name?: string | number | Id) {
  const text = String(name || "L");
  return text.slice(0, 2).toUpperCase();
}

function timeText(ts?: number) {
  if (!ts) return "";
  const ms = ts > 10_000_000_000 ? ts : ts * 1000;
  return new Date(ms).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function render() {
  app.innerHTML = token() ? renderApp() : renderAuth();
  bindEvents();
}

function renderAuth() {
  return `
    <main class="auth-page">
      <section class="auth-visual">
        <img src="/lark-logo.png" alt="Lark" />
        <h1>Lark IM</h1>
        <p>即时消息、联系人、群聊、邀请、会话和红包，直接连接本地 Go 后端。</p>
      </section>
      <section class="auth-card">
        <div class="segmented">
          <button class="${state.loginMode === "signin" ? "active" : ""}" data-action="login-mode" data-mode="signin">登录</button>
          <button class="${state.loginMode === "signup" ? "active" : ""}" data-action="login-mode" data-mode="signup">注册</button>
        </div>
        ${state.loginMode === "signin" ? renderSignin() : renderSignup()}
        ${renderNotice()}
      </section>
    </main>
  `;
}

function renderSignin() {
  return `
    <div class="auth-form">
      <label>账号<input id="signinAccount" placeholder="手机号或 Lark ID" /></label>
      <label>密码<input id="signinPassword" type="password" placeholder="输入密码，前端会自动 MD5" /></label>
      <div class="two">
        <label>账号类型<select id="signinType"><option value="1">手机号</option><option value="2">Lark ID</option></select></label>
        <label>平台<select id="signinPlatform"><option value="5">Web</option><option value="4">PC</option><option value="1">iOS</option><option value="2">Android</option></select></label>
      </div>
      <label>UDID<input id="signinUdid" value="${defaultUdid()}" /></label>
      <button class="primary" data-action="signin">进入聊天</button>
    </div>
  `;
}

function renderSignup() {
  return `
    <div class="auth-form">
      <label>昵称<input id="signupNickname" placeholder="昵称" /></label>
      <label>手机号<input id="signupMobile" placeholder="手机号" /></label>
      <label>密码<input id="signupPassword" type="password" placeholder="输入密码，前端会自动 MD5" /></label>
      <div class="two">
        <label>Firstname<input id="signupFirstname" value="Lark" /></label>
        <label>Lastname<input id="signupLastname" value="User" /></label>
      </div>
      <div class="two">
        <label>性别<select id="signupGender"><option value="0">保密</option><option value="1">男</option><option value="2">女</option></select></label>
        <label>邮箱<input id="signupEmail" /></label>
      </div>
      <label>UDID<input id="signupUdid" value="${defaultUdid()}" /></label>
      <button class="primary" data-action="signup">创建账号</button>
    </div>
  `;
}

function renderApp() {
  return `
    <main class="im-shell ${state.drawer ? "has-drawer" : ""}">
      <aside class="rail">
        <div class="brand">
          <div class="avatar">${initials(state.user?.nickname || state.user?.uid)}</div>
          <strong>Lark</strong>
        </div>
        <nav>
          ${navButton("conversations", "消息", state.conversations.length)}
          ${navButton("contacts", "通讯录", state.contacts.length)}
          ${navButton("groups", "群组", state.groups.length)}
          ${navButton("invites", "邀请", state.invites.length + state.outgoingInvites.length)}
        </nav>
        <div class="rail-bottom">
          <button class="icon-button" data-action="drawer" data-drawer="profile">我</button>
          <button class="icon-button muted" data-action="refresh">刷</button>
          <button class="icon-button muted" data-action="signout">退</button>
        </div>
      </aside>
      <section class="list-pane">
        ${renderListPane()}
      </section>
      <section class="chat-pane">
        ${renderChat()}
      </section>
      ${state.drawer ? renderDrawer() : ""}
    </main>
    ${renderNotice()}
  `;
}

function navButton(pane: Pane, label: string, count = 0) {
  return `
    <button class="${state.pane === pane ? "active" : ""}" data-action="pane" data-pane="${pane}">
      <span>${label}</span>
      ${count ? `<em>${count}</em>` : ""}
    </button>
  `;
}

function renderListPane() {
  if (state.pane === "contacts") return renderContacts();
  if (state.pane === "groups") return renderGroups();
  if (state.pane === "invites") return renderInvites();
  return renderConversations();
}

function renderConversations() {
  return `
    <header class="pane-head">
      <div><h2>消息</h2><p>${state.busy ? "同步中" : "最近会话"}</p></div>
      <button class="text-button" data-action="refresh">刷新</button>
    </header>
    <div class="items">
      ${state.conversations.map((item) => `
        <button class="item ${sameId(state.currentChat?.chat_id, item.chat_id) ? "active" : ""}" data-action="select-chat" data-chat="${html(item.chat_id)}">
          <span class="avatar small">${initials(item.title || item.chat_id)}</span>
          <span><strong>${html(item.title || item.chat_id)}</strong><em>${timeText(item.srv_ts) || "暂无新消息"}</em></span>
        </button>
      `).join("") || empty("还没有会话，先去通讯录找人或创建群聊")}
    </div>
  `;
}

function renderContacts() {
  return `
    <header class="pane-head">
      <div><h2>通讯录</h2><p>好友申请被同意后才会出现在会话里</p></div>
      <button class="text-button" data-action="refresh">刷新</button>
    </header>
    <div class="command-bar">
      <input id="userQuery" placeholder="手机号 / Lark ID / 昵称" />
      <button data-action="search-users">搜索</button>
      <button class="ghost" data-action="invite-direct">申请</button>
    </div>
    ${renderUserResults()}
    <div class="items">
      ${state.contacts.map((item) => `
        <article class="item static">
          <span class="avatar small">${initials(displayUserName(item.uid, item.alias || item.remark || "好友"))}</span>
          <span><strong>${html(displayUserName(item.uid, item.alias || item.remark || "好友"))}</strong><em>${html(displayUserSubtitle(item.uid))}</em></span>
          <button class="text-button" data-action="open-contact" data-uid="${html(item.uid)}">发消息</button>
        </article>
      `).join("") || empty("暂无联系人")}
    </div>
  `;
}

function renderUserResults() {
  const found = state.userResults.map((item) => `
    <article class="item static compact">
      <span class="avatar small">${initials(item.nickname || item.uid)}</span>
      <span><strong>${html(item.nickname || item.lark_id || "Lark 用户")}</strong><em>${html(item.lark_id ? `Lark ID ${item.lark_id}` : "可发送好友申请")}</em></span>
      <button data-action="invite-found-user" data-uid="${html(item.uid)}">添加</button>
    </article>
  `).join("");
  const users = state.userList.map((item) => `
    <article class="item static compact">
      <span class="avatar small">${initials(item.nickname || item.uid)}</span>
      <span><strong>${html(item.nickname || item.lark_id || item.uid)}</strong><em>${html(item.firstname || "")} ${html(item.lastname || "")}</em></span>
    </article>
  `).join("");
  if (!found && !users) return "";
  return `<div class="items results">${found}${users}</div>`;
}

function renderGroups() {
  return `
    <header class="pane-head">
      <div><h2>群组</h2><p>创建和进入团队会话</p></div>
      <button class="text-button" data-action="refresh">刷新</button>
    </header>
    <div class="create-box compact-form">
      <input id="groupName" placeholder="群名称" />
      <input id="groupMembers" placeholder="成员手机号 / Lark ID / 昵称，创建后发送邀请" />
      <button data-action="create-group">创建群聊</button>
      <input id="groupAbout" placeholder="群简介，可选" />
    </div>
    <div class="items">
      ${state.groups.map((item) => `
        <button class="item" data-action="open-group" data-chat="${html(item.chat_id)}">
          <span class="avatar small">${initials(item.chat_name || item.chat_id)}</span>
          <span><strong>${html(item.chat_name || item.remark || "群聊")}</strong><em>群成员邀请通过后加入</em></span>
        </button>
      `).join("") || empty("暂无群聊")}
    </div>
  `;
}

function renderInvites() {
  return `
    <header class="pane-head">
      <div><h2>邀请</h2><p>同意后才会建立联系人或加入群聊</p></div>
      <button class="text-button" data-action="refresh">刷新</button>
    </header>
    ${currentChatIsGroup() ? `
      <div class="create-box compact-form">
        <input id="inviteUids" placeholder="邀请成员手机号 / Lark ID / 昵称" />
        <input id="inviteMessage" placeholder="邀请消息" />
        <button data-action="invite-group">邀请入群</button>
      </div>
    ` : ""}
    <div class="items">
      <h3 class="list-title">收到的申请</h3>
      ${state.invites.map((item) => `
        <article class="item invite">
          <span class="avatar small">${initials(item.initiator_info?.nickname || displayUserName(item.initiator_uid, "申请"))}</span>
          <span><strong>${html(inviteTitle(item))}</strong><em>${html(item.invitation_msg || "等待处理")}</em></span>
          <span class="actions">
            <button data-action="handle-invite" data-result="1" data-invite="${item.invite_id}">同意</button>
            <button class="ghost" data-action="handle-invite" data-result="2" data-invite="${item.invite_id}">拒绝</button>
          </span>
        </article>
      `).join("") || empty("暂无待处理邀请")}
      <h3 class="list-title">我发出的申请</h3>
      ${state.outgoingInvites.map((item) => `
        <article class="item invite">
          <span class="avatar small">${item.chat_type === 2 ? "群" : "友"}</span>
          <span><strong>${html(inviteStatus(item))}</strong><em>${html(item.invitation_msg || "")}</em></span>
        </article>
      `).join("") || empty("暂无发出的申请")}
    </div>
  `;
}

function inviteTitle(item: Invite) {
  const who = item.initiator_info?.nickname || displayUserName(item.initiator_uid, "有人");
  return item.chat_type === 2 ? `${who} 邀请你加入群聊` : `${who} 请求添加你为好友`;
}

function inviteStatus(item: Invite) {
  const who = displayUserName(item.invitee_uid, "对方");
  const target = item.chat_type === 2 ? `邀请 ${who} 入群` : `添加 ${who}`;
  if (item.handle_result === 1) return `${target} · 已同意`;
  if (item.handle_result === 2) return `${target} · 已拒绝`;
  return `${target} · 等待对方处理`;
}

function renderChat() {
  if (!state.currentChat) {
    return `
      <div class="empty-chat">
        <img src="/lark-logo.png" alt="Lark" />
        <h2>选择一个会话</h2>
        <p>从消息、通讯录或群组开始。</p>
      </div>
    `;
  }
  return `
    <header class="chat-head">
      <div>
        <h2>${html(state.currentChat.title || state.currentChat.chat_id)}</h2>
        <span>${wsStatus()} · ${html(state.pushStatus)}</span>
      </div>
      <div class="chat-actions">
        <button data-action="drawer" data-drawer="search">搜索</button>
        <button data-action="drawer" data-drawer="members">成员</button>
        ${currentChatIsGroup() ? `<button data-action="drawer" data-drawer="group">群设置</button>` : ""}
        <button data-action="drawer" data-drawer="red">红包</button>
        <button data-action="drawer" data-drawer="location">位置</button>
        <button class="text-button" data-action="ws-connect">推送</button>
      </div>
    </header>
    <div class="messages">
      ${state.messages.map(renderMessage).join("") || empty("暂无消息")}
    </div>
    <footer class="composer">
      <textarea id="messageInput" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
      <button data-action="send">发送</button>
    </footer>
  `;
}

function renderMessage(item: ChatMessage) {
  const mine = sameId(item.sender_id, state.user?.uid);
  const senderName = item.sender_name || item.alias || displayUserName(item.sender_id, "未知用户");
  return `
    <article class="message ${mine ? "mine" : ""}">
      <div class="avatar tiny">${initials(senderName)}</div>
      <div class="bubble">
        <span>${html(senderName)} · ${timeText(item.srv_ts || item.sent_ts)}</span>
        <p>${html(item.body || "")}</p>
      </div>
    </article>
  `;
}

function renderDrawer() {
  const title = {
    profile: "个人资料",
    location: "位置",
    red: "红包",
    members: "成员",
    group: "群设置",
    search: "搜索"
  }[state.drawer || "profile"];
  return `
    <aside class="drawer">
      <header>
        <h2>${title}</h2>
        <button class="icon-button muted" data-action="close-drawer">×</button>
      </header>
      ${state.drawer === "profile" ? renderProfilePanel() : ""}
      ${state.drawer === "location" ? renderLocationPanel() : ""}
      ${state.drawer === "red" ? renderRedPanel() : ""}
      ${state.drawer === "members" ? renderMembersPanel() : ""}
      ${state.drawer === "group" ? renderGroupPanel() : ""}
      ${state.drawer === "search" ? renderSearchPanel() : ""}
    </aside>
  `;
}

function renderProfilePanel() {
  return `
    <section class="panel">
      <input id="profileNickname" value="${html(state.user?.nickname || "")}" placeholder="昵称" />
      <button data-action="update-profile">保存资料</button>
      <p class="meta-line">${html(state.user?.lark_id ? `Lark ID ${state.user.lark_id}` : "本地账号")}</p>
      <button class="ghost" data-action="signout">退出登录</button>
    </section>
  `;
}

function renderLocationPanel() {
  return `
    <section class="panel">
      <div class="two">
        <input id="lng" value="116.397128" />
        <input id="lat" value="39.916527" />
      </div>
      <button data-action="report-location">上报位置</button>
      <button class="ghost" data-action="people-nearby">附近的人</button>
    </section>
  `;
}

function renderRedPanel() {
  return `
    <section class="panel">
      <input id="redAmount" value="100" placeholder="金额(分)" />
      <input id="redQuantity" value="1" placeholder="数量" />
      <input id="redReceivers" placeholder="指定领取人手机号 / Lark ID / 昵称，可空" />
      <input id="redMessage" value="恭喜发财" />
      <input id="payPassword" type="password" placeholder="支付密码" />
      <input id="redEnvId" placeholder="红包 ID，用于抢/拆/建订单" />
      <select id="payType"><option value="1">支付方式 1</option><option value="2">支付方式 2</option></select>
      <button data-action="give-red">发送红包</button>
      <button class="ghost" data-action="grab-red">抢红包</button>
      <button class="ghost" data-action="open-red">拆红包</button>
      <button class="ghost" data-action="create-red-order">创建红包订单</button>
      <div class="two">
        <button class="ghost" data-action="order-info">订单信息</button>
        <button class="ghost" data-action="payment-info">支付信息</button>
      </div>
      ${state.redResult ? `<p class="result-line dark">${html(state.redResult)}</p>` : ""}
      ${state.financeResult ? `<p class="result-line dark">${html(state.financeResult)}</p>` : ""}
    </section>
  `;
}

function renderMembersPanel() {
  return `
    <section class="panel">
      ${currentChatIsGroup() ? `
        <div class="inline-form">
          <input id="memberInviteQuery" placeholder="手机号 / Lark ID / 昵称" />
          <button data-action="invite-current-group">邀请</button>
        </div>
      ` : ""}
      <button class="ghost" data-action="load-members">同步成员</button>
      <div class="member-list">
        ${state.members.map((item) => `
          <article>
            <span class="avatar small">${initials(displayUserName(item.uid, item.alias || "成员"))}</span>
            <div><strong>${html(displayUserName(item.uid, item.alias || "成员"))}</strong><em>${html(roleText(item.role_id))}</em></div>
          </article>
        `).join("") || empty("还没有加载成员")}
      </div>
    </section>
  `;
}

function renderGroupPanel() {
  if (!currentChatIsGroup()) {
    return `<section class="panel">${empty("当前是单聊，没有群设置")}</section>`;
  }
  return `
    <section class="panel">
      <button data-action="group-details">同步群详情</button>
      <input id="editGroupName" placeholder="群名称" />
      <input id="editGroupAbout" placeholder="群简介" />
      <button data-action="edit-group">保存群资料</button>
      <input id="removeMembers" placeholder="移除成员手机号 / Lark ID / 昵称" />
      <button class="ghost" data-action="remove-members">移除成员</button>
      <button class="danger" data-action="quit-group">退出群聊</button>
      ${renderGroupDetailsInfo()}
    </section>
  `;
}

function renderGroupDetailsInfo() {
  const details = state.groupDetails as any;
  if (!details) return "";
  return `
    <div class="detail-box">
      <p><strong>${html(details.name || state.currentChat?.title || "群聊")}</strong></p>
      <p>${html(details.about || "暂无群简介")}</p>
      <p>创建者：${html(details.creator?.nickname || details.creator?.lark_id || "未知")}</p>
    </div>
  `;
}

function renderSearchPanel() {
  return `
    <section class="panel">
      <div class="inline-form">
        <input id="messageSearch" placeholder="搜索当前会话" />
        <button data-action="search-messages">搜索</button>
      </div>
      <div class="search-results">
        ${state.messageResults.map((item) => `
          <article><strong>#${html(item.seq_id || item.srv_msg_id || "-")}</strong><p>${html(item.rt || item.body || "")}</p></article>
        `).join("") || empty("没有搜索结果")}
      </div>
    </section>
  `;
}

function renderNotice() {
  if (!state.notice && !state.error) return "";
  return `<div class="toast ${state.error ? "error" : ""}">${html(state.error || state.notice)}</div>`;
}

function empty(text: string) {
  return `<p class="empty">${text}</p>`;
}

function wsStatus() {
  const open = state.ws?.readyState === WebSocket.OPEN;
  return `<em class="${open ? "online" : "offline"}">${open ? "实时在线" : "实时未连"}</em>`;
}

function roleText(role?: number) {
  if (role === 1) return "群主";
  if (role === 2) return "管理员";
  return "成员";
}

function currentChatIsGroup() {
  return !!state.currentChat?.chat_id && (state.currentChat.chat_type === 2 || state.groups.some((item) => sameId(item.chat_id, state.currentChat?.chat_id)));
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((node) => {
    node.addEventListener("click", async () => {
      const action = node.dataset.action;
      if (action === "login-mode") {
        state.loginMode = node.dataset.mode === "signup" ? "signup" : "signin";
        render();
      }
      if (action === "signin") await signIn();
      if (action === "signup") await signUp();
      if (action === "signout") await signOut();
      if (action === "refresh") await refreshAll();
      if (action === "pane") {
        state.pane = (node.dataset.pane as Pane) || "conversations";
        state.drawer = null;
        render();
      }
      if (action === "drawer") await openDrawer((node.dataset.drawer as Drawer) || null);
      if (action === "close-drawer") {
        state.drawer = null;
        render();
      }
      if (action === "select-chat") {
        const chatId = node.dataset.chat || "";
        const convo = state.conversations.find((item) => sameId(item.chat_id, chatId));
        if (convo) await selectConversation(convo);
      }
      if (action === "open-group") {
        const chatId = node.dataset.chat || "";
        const group = state.groups.find((item) => sameId(item.chat_id, chatId));
        if (group) await openGroup(group);
      }
      if (action === "load-messages") await loadMessages();
      if (action === "load-members") await loadChatMembers();
      if (action === "group-details") await loadGroupDetails();
      if (action === "search-messages") await searchMessages();
      if (action === "operate-message") await operateMessage();
      if (action === "send") await sendMessage();
      if (action === "create-group") await createGroup();
      if (action === "invite-private") await inviteUser(1);
      if (action === "invite-direct") await inviteDirect();
      if (action === "invite-group") await inviteUser(2);
      if (action === "invite-current-group") await inviteCurrentGroup();
      if (action === "invite-found-user" && node.dataset.uid) await inviteUser(1, [node.dataset.uid]);
      if (action === "open-contact" && node.dataset.uid) await openContact(node.dataset.uid);
      if (action === "search-users") await searchUsers();
      if (action === "lookup-users") await lookupUsers();
      if (action === "delete-contact") await deleteContact();
      if (action === "edit-group") await editGroup();
      if (action === "remove-members") await removeGroupMembers();
      if (action === "quit-group") await quitGroup();
      if (action === "handle-invite" && node.dataset.invite) await handleInvite(node.dataset.invite, Number(node.dataset.result) as 1 | 2);
      if (action === "update-profile") await updateProfile();
      if (action === "report-location") await reportLocation();
      if (action === "people-nearby") await peopleNearby();
      if (action === "give-red") await giveRedEnvelope();
      if (action === "grab-red") await grabRedEnvelope();
      if (action === "open-red") await openRedEnvelope();
      if (action === "create-red-order") await createRedOrder();
      if (action === "order-info") await queryFinance("order");
      if (action === "payment-info") await queryFinance("payment");
      if (action === "ws-connect") connectWs();
    });
  });

  document.querySelector<HTMLTextAreaElement>("#messageInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
}

bootstrap();
