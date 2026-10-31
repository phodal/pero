/** Fixed user-consent capabilities shared by Host and Point UI. */
/** @type {Readonly<Record<string, string[]>>} */
export const FEISHU_CAPABILITY_SCOPES = Object.freeze({
  documents: ['search:docs:read', 'docx:document:readonly'],
  files:['drive:drive:readonly','drive:drive.metadata:readonly'], wiki:['wiki:space:retrieve','wiki:node:retrieve'], slides:['slides:presentation:read'], chats:['im:chat:read','im:message:readonly'], deliverables: ['docx:document:create'], calendar: ['calendar:calendar.event:read'],
  meetings: ['vc:meeting.meetingevent:read', 'vc:note:read'],
  base: ['base:table:read','base:field:read','base:record:create'],
});
