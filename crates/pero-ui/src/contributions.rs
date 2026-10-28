//! Public human contributions reuse local ACP sessions; no Worker execution is fabricated.
use crate::{app::Workbench, conversation::Conversation, remote::string};
use gpui_kit::{component::{button::*, *}, prelude::*, *};
use pero_contracts::HostEvent;
use serde_json::{Value, json};

pub(crate) struct ContributionState {
    pub data: Value,
    pub requested: bool,
}
impl Default for ContributionState {
    fn default() -> Self {
        Self { data: json!({"loading":false,"error":null,"contributions":[],"selected_task_id":null,"detail":null,"local":null,"has_more":false}), requested: false }
    }
}
impl Workbench {
    pub(crate) fn receive_contribution(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind == "contributor_state" {
            self.contribution.data = event.data.clone();
            cx.notify();
            return true;
        }
        if event.kind != "contributor_session" { return false; }
        if let Some(id) = event.thread_id.as_ref() {
            let index = match self.chats.iter().position(|chat| &chat.id == id) {
                Some(index) => index,
                None => {
                    self.chats.push(Conversation::new(id.clone(), string(&event.data, "agent_id").to_string(), event.text.clone()));
                    self.chats.len() - 1
                }
            };
            self.workspace = string(&event.data, "workspace").to_string();
            self.navigation = 0;
            self.focus_chat(Some(index), 4, cx);
        }
        true
    }
    fn contribution_action(&mut self, action: &str, cx: &mut Context<Self>) {
        let task_id = string(&self.contribution.data, "selected_task_id").to_string();
        self.command(json!({"action":format!("remote_contribution_{action}"),"task_id":task_id,"agent_id":self.remote_agent()}), cx);
    }
    pub(crate) fn contribution_view(&self, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let p = self.palettes.get(self.dark);
        let data = &self.contribution.data;
        let selected = string(data, "selected_task_id");
        let busy = data["loading"].as_bool().unwrap_or(false);
        let rows = data["contributions"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        div().flex_1().min_h_0().flex().flex_col()
            .when(data["error"].is_string(), |el| el.child(div().id("contribution-error").role(Role::Alert).px(px(20.)).py(px(10.)).bg(p.color("error-bg")).text_color(p.color("error")).whitespace_normal().child(string(data,"error").to_string())))
            .child(div().flex().items_center().justify_between().px(px(20.)).py(px(12.)).border_b_1().border_color(p.color("border"))
                .child(div().font_weight(FontWeight::BOLD).child(self.t("contribution.title")))
                .child(Button::new("contribution-refresh").outline().small().label(self.t(if busy {"contribution.loading"} else {"remote.refresh"})).disabled(busy).on_click(cx.listener(|this,_,_,cx|this.contribution_action("refresh",cx)))))
            .child(div().flex_1().min_h_0().flex()
                .when(!narrow || selected.is_empty(), |el| el.child(div().id("contribution-list").w(if narrow {px(800.)} else {px(320.)}).min_w_0().h_full().flex().flex_col().border_r_1().border_color(p.color("border"))
                    .child(div().id("contribution-rows").flex_1().overflow_y_scroll().py(px(6.))
                        .when(rows.is_empty(), |el| el.child(div().p(px(20.)).whitespace_normal().text_color(p.color("text-muted")).child(self.t(if busy {"contribution.loading"} else {"contribution.empty"}))))
                        .children(rows.iter().enumerate().map(|(index,task)| {
                            let id=string(task,"task_id").to_string();
                            div().px(px(8.)).py(px(3.)).child(Button::new(("contribution-row",index)).ghost().w_full().h_auto().min_h(px(54.)).toggled(selected==id).disabled(busy)
                                .label(format!("{}\n{} · {}",string(task,"title"),string(task,"repository"),self.contribution_status(string(task,"state"))))
                                .on_click(cx.listener(move|this,_,_,cx|this.command(json!({"action":"remote_contribution_select","task_id":id}),cx))))
                        })))
                    .when(data["has_more"].as_bool().unwrap_or(false),|el|el.child(Button::new("contribution-more").ghost().small().label(self.t("remote.more")).disabled(busy).on_click(cx.listener(|this,_,_,cx|this.contribution_action("more",cx)))))))
                .when(!narrow || !selected.is_empty(),|el|el.child(self.contribution_detail(narrow,cx))))
    }
    fn contribution_status(&self, state: &str) -> &'static str {
        self.t(match state {
            "available"=>"contribution.available", "claimed"=>"contribution.claimed", "submitted"=>"contribution.submitted", "closed"=>"contribution.closed",
            "source_changed"=>"contribution.source_changed", "running"=>"contribution.running", "accepted"=>"contribution.accepted", _=>"contribution.available",
        })
    }
    fn contribution_detail(&self, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let p=self.palettes.get(self.dark);
        let data=&self.contribution.data;
        let task=&data["detail"];
        let local=&data["local"];
        let busy=data["loading"].as_bool().unwrap_or(false);
        let mine=!string(&task["claimed_by"],"id").is_empty() && string(&task["claimed_by"],"id")==string(&self.remote.data["identity"],"id");
        let available=string(task,"state")=="available";
        let workable=mine && matches!(string(task,"state"),"claimed"|"submitted");
        let local_busy=local["thread_id"].is_string() && !matches!(string(local,"session_state"),"idle"|"closed"|"auth_required");
        let reviewed=string(local,"status")=="review" && !string(local,"review_token").is_empty();
        let publishable=reviewed && local["gh_authenticated"].as_bool().unwrap_or(false);
        div().id("contribution-detail").flex_1().min_w_0().h_full().overflow_y_scroll().p(px(20.)).flex().flex_col().gap(px(14.))
            .when(task.is_null(),|el|el.child(div().text_color(p.color("text-muted")).child(self.t("contribution.select"))))
            .when(task.is_object(),|el|el
                .when(narrow,|el|el.child(Button::new("contribution-back").ghost().small().label(self.t("contribution.back")).on_click(cx.listener(|this,_,_,cx|{this.contribution.data["selected_task_id"]=Value::Null;this.contribution.data["detail"]=Value::Null;cx.notify();}))))
                .child(div().text_size(px(20.)).font_weight(FontWeight::BOLD).whitespace_normal().child(string(task,"title").to_string()))
                .child(div().flex().flex_wrap().items_center().gap(px(8.)).text_color(p.color("text-muted"))
                    .child(string(task,"repository").to_string()).child(self.contribution_status(string(task,"state")))
                    .when(task["claimed_by"].is_object(),|el|el.child(string(&task["claimed_by"],"name").to_string()))
                    .child(Button::new("contribution-source").ghost().small().label(self.t("contribution.source")).disabled(busy).on_click(cx.listener(|this,_,_,cx|this.contribution_action("source",cx)))))
                .child(div().whitespace_normal().child(string(task,"description").to_string()))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .when(available,|el|el.child(Button::new("contribution-claim").primary().label(self.t("remote.claim")).disabled(busy).on_click(cx.listener(|this,_,_,cx|this.contribution_action("claim",cx)))))
                    .when(workable,|el|el
                        .child(Button::new("contribution-start").primary().label(self.t(if local["thread_id"].is_string() && string(local,"session_state")!="closed" {"contribution.continue"} else {"contribution.start"})).disabled(busy).on_click(cx.listener(|this,_,_,cx|this.contribution_action("start",cx))))
                        .child(Button::new("contribution-review").outline().label(self.t("contribution.review")).disabled(busy||local.is_null()||local_busy).on_click(cx.listener(|this,_,_,cx|this.contribution_action("review",cx))))
                        .child(Button::new("contribution-release").ghost().label(self.t("remote.release")).disabled(busy||local_busy||task["pull_request"].is_object()).on_click(cx.listener(|this,_,_,cx|this.contribution_action("release",cx))))))
                .when(workable&&local.is_null(),|el|el
                    .child(div().font_weight(FontWeight::SEMIBOLD).child(self.t("contribution.agent")))
                    .child(div().flex().flex_wrap().gap(px(8.)).children(self.agents.iter().enumerate().map(|(i,agent)| {
                        let id=agent.id.clone();
                        Button::new(("contribution-agent",i)).outline().small().label(agent.name.clone()).toggled(self.remote_agent()==agent.id).disabled(!agent.available||busy).on_click(cx.listener(move|this,_,_,cx|{this.remote.agent=Some(id.clone());cx.notify();}))
                    })))
                    .child(div().text_size(px(12.)).text_color(p.color("text-muted")).whitespace_normal().child(self.t("contribution.setup"))))
                .when(local.is_object(),|el|el
                    .child(div().text_size(px(12.)).text_color(p.color("text-muted")).whitespace_normal().child(format!("{}\n{}",string(local,"workspace"),string(local,"branch"))))
                    .when(local_busy,|el|el.child(div().id("contribution-agent-state").role(Role::Status).child(self.t("contribution.agent_running")))))
                .when(workable,|el|el
                    .when(local.is_object(),|el|el
                    .when(!local["gh_available"].as_bool().unwrap_or(false),|el|el.child(div().id("contribution-gh-state").role(Role::Alert).text_color(p.color("warning")).whitespace_normal().child(self.t("contribution.gh_missing"))))
                    .when(local["gh_available"].as_bool().unwrap_or(false)&&!local["gh_authenticated"].as_bool().unwrap_or(false),|el|el.child(div().id("contribution-gh-state").role(Role::Alert).text_color(p.color("warning")).whitespace_normal().child(self.t("contribution.gh_auth"))))
                    )
                    .child(Button::new("contribution-gh-help").ghost().small().label(self.t("contribution.gh_help")).disabled(busy).on_click(cx.listener(|this,_,_,cx|this.contribution_action("gh_help",cx)))))
                .when(reviewed,|el|el
                    .child(div().font_weight(FontWeight::SEMIBOLD).child(self.t("contribution.review_title")))
                    .child(div().id("contribution-diff").max_h(px(420.)).overflow_y_scroll().p(px(12.)).bg(p.color("surface-muted")).font_family("JetBrains Mono").text_size(px(12.)).whitespace_normal().child(if string(local,"diff").is_empty() {self.t("contribution.no_changes").to_string()} else {string(local,"diff").to_string()}))
                    .child(div().text_size(px(12.)).text_color(p.color("text-muted")).whitespace_normal().child(self.t("contribution.publish_help")))
                    .child(Button::new("contribution-publish").primary().label(self.t("contribution.publish")).disabled(busy||local_busy||!publishable||local["changed_files"].as_array().is_none_or(Vec::is_empty)).on_click(cx.listener(|this,_,_,cx|this.contribution_action("publish",cx)))))
                .when(task["pull_request"].is_object()||local["pr_url"].is_string(),|el|el
                    .child(div().id("contribution-pr-state").role(Role::Status).text_color(p.color("success")).child(self.t(if task["pull_request"].is_object(){"contribution.pr_saved"}else{"contribution.pr_pending"})))
                    .child(div().flex().gap(px(8.))
                        .child(Button::new("contribution-open-pr").outline().label(self.t("contribution.open_pr")).on_click(cx.listener(|this,_,_,cx|this.contribution_action("open_pr",cx))))
                        .when(!task["pull_request"].is_object(),|el|el.child(Button::new("contribution-submit").primary().label(self.t("contribution.retry_submit")).disabled(busy).on_click(cx.listener(|this,_,_,cx|this.contribution_action("submit",cx))))))))
    }
}
