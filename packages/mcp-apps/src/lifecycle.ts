/** Revoke authority before asking untrusted App code to cooperate with dismissal. */
export async function closeMcpView(view:{revoke():Promise<unknown>;teardown():Promise<unknown>;dispose():Promise<void>}){
  try{await view.revoke();}
  finally{try{await view.teardown();}finally{await view.dispose();}}
}
