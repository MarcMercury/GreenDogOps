# Green Dog Recruiting Workflow — How We Use the Ops ATS

**Audience:** Everyone who posts jobs, reviews applicants, or interviews candidates.
**Goal:** Every candidate goes into one system (the Ops ATS) in the same format, with full contact details and resume attached, so anyone on the team can pick up a candidate and move them forward.

---

## The workflow at a glance

```
 Job posting ──► Green Dog Application (/apply)
                         │
                 REVIEW QUEUE ── Reject ──► REJECTED (48-hour window ─► automatic email)
                         │
                      Approve
                         │
     Next step: 📝 Send Additional Form · 📞 Schedule Phone Interview · 👋 Schedule In-Person
                         │
                 FORM RESPONSES ── review answers + update score ── Reject ──► REJECTED
                         │
                   INTERVIEWS ── phone screen ─► completed ─► advance to in-person
                         │
         In-person interview or shadow scheduled ──► 🚨 FIRST SLACK ANNOUNCEMENT
                         │
         Every later update replies in that one Slack thread
                         │
              Shadow / more interviews ─► 💼 Offer ─► 🎉 Hire
```

**Ops handles recruiting.** Applications, forms, scores, reviews, scheduling and early interviews all stay in the ATS.
**Slack handles team awareness.** A candidate first appears in Slack when they're coming into one of our clinics (an in-person interview or shadow is scheduled), and from then on their whole hiring history lives in that one thread.

**The rule:** If a candidate isn't in the Ops ATS, they aren't in our process. We don't track candidates in Indeed, email, or text threads.

---

## Roles

| Role | Responsibility |
|---|---|
| **Job Poster** (Recruiting lead) | Opens and closes **Jobs** in the ATS, posts and maintains the matching Indeed ads, and makes sure every ad has the auto-reply turned on. |
| **Daily Reviewer** | Clears the ATS Review Queue every business day by approving or denying each applicant. |
| **Interviewer** (anyone with ATS edit access) | Picks up approved candidates from Slack, launches the interview, and moves them forward. |
| **Hiring Manager / Admin** | Makes final decisions, sends offers, and clicks **Hire → Employee**. |

---

## Step 0 — Open the job in the ATS

Every candidate is linked to a **Job** in the ATS, the same way Indeed for employers groups applicants under the job they applied to.

1. Open **Ops → Recruiting (ATS) → Jobs** and click **+ Job**.
2. Pick the role(s) and clinic(s). One job is created per role + clinic, for example *CSR — Van Nuys*. Add the openings, schedule, pay and requirements.
3. When the job is filled or paused, click **Close job** and choose why: **Filled**, **Cancelled** or **On hold**. If candidates are still being worked for that job, you can:
   - leave them on the closed job,
   - move them all to another open job, or
   - put the active ones on **Hold for Future**.
4. **Reopen** a closed job any time from the same row. Tick **Show closed jobs** to see closed ones.

Closing a job never removes anyone. Its candidates stay in **All Candidates** and can be moved to an open job at any time. Click a job's candidate count to see its candidates grouped by stage, including anyone already hired into it.

> Jobs can't be deleted once a candidate or employee is linked to them. Close them instead.

---

## Step 1 — Post the ad on Indeed (with auto-reply)

Indeed is our main source of candidates. Indeed applications usually arrive **without** a phone number, email, or resume. That's why every candidate must also complete the **Green Dog Application**.

**Which link to use:** On the **Jobs** tab, each open job has a **🔗 Application link** button. It opens the Green Dog Application (`<ops>/apply?job=…`) with that job already selected, so the candidate is linked to the right job. Add `&source=Indeed` to the link in Indeed ads so the source is recorded. The general link is `<ops>/apply`. The website careers form still works in parallel until every ad has switched over.

**For every Indeed ad:**

1. Post the ad as normal (title, location, pay, schedule).
2. Turn on an **automatic reply/message** to every applicant that sends them to our careers page form. Use the template below.
3. Use the **same role title and clinic** in the ad and on the careers form's "Role Applying For" list as the open Job in the ATS. The ATS uses the title and clinic to link each application to its job automatically.
4. Each time you create or repost an ad, check that the auto-reply is still on.

**Auto-reply template (copy/paste):**

> Hi {first name},
>
> Thanks for applying to **{position}** at Green Dog! To be considered, please complete our short application on our careers page:
>
> 👉 **[APPLICATION LINK]**
>
> Please attach your resume. The form takes about 3 minutes. We review new applications every business day and will reach out if you're a fit.
>
> — The Green Dog Team

> ⚠️ Replace `[APPLICATION LINK]` with the job's **🔗 Application link** from the Jobs tab before turning the auto-reply on.

---

## Step 2 — Candidate completes the application → lands in the Review Queue automatically

### The Green Dog Application (in Ops)

The Standard Application lives on the **Forms** tab (see *Forms* below) and is served publicly at `<ops>/apply`. It always asks for **first and last name, email, phone, position applying for (the open jobs), city or ZIP, resume (upload) and cover letter / notes**, followed by the standard application questions you set up in the form builder.

Submitting it immediately:
- creates (or updates) the candidate profile, linked to the job they picked;
- saves the resume and any uploaded files on the **Documents** tab;
- saves every answer on the profile's **Forms** tab ("Green Dog Application ✅ Completed …");
- puts them in the **Review Queue**.

### The website careers form (until the ads switch over)

The website careers form is also connected to the Ops ATS. You don't need to do anything here.

- When a candidate submits the form, the submission goes to the careers inbox. **About every 5 minutes**, the ATS pulls it in and creates a candidate profile.
- The profile includes: **Name, Email, Phone, Role Applying For, Practice/Location, Cover letter/notes, Source,** and the **uploaded resume** (PDF/Word/image), downloaded from the form and saved on the candidate's Documents tab. A resume pasted as text is saved there too.
- **Source** is "Indeed" when the applicant came from an Indeed ad's link (see *Per-ad links* below), otherwise their answer to "How did you hear about us?", otherwise "GD Website".
- Everything else on the full application form lands on the profile, split across tabs:
  - **Overview:** the editable recruiting record, plus an **Application snapshot** (start date, availability, pay, experience, license, languages, and any ⚠ eligibility flags).
  - **Application:** position and availability, contact preferences, eligibility, written responses, acknowledgements and signature, posting/tracking, job-board screening answers, application history, and any **Other answers** the ATS didn't recognize.
  - **Experience & Skills:** experience, employment history, education and credentials, role-specific details (DVM / RVT / foreign-graduate / remote setup), skills grids, languages and references.
  - Recruiters can correct any of it with **✎ Edit details**, then **Save changes**.
- **Repeat applicants** are recognized automatically and added to their existing profile, so we don't get duplicates.
- Every new applicant starts in **Recruiting (ATS) → Review Queue** with status *Pending*.

**What the careers form must collect** (so the Review page has everything):

| Field | Required |
|---|---|
| Name (or First Name + Last Name) | ✅ |
| Email | ✅ |
| Phone Number | ✅ |
| Role Applying For | ✅ |
| Practice/Location | ✅ |
| Resume (file upload) | ✅ |
| Cover Letter / Notes | Optional |

### For IT: how form fields map into the ATS

The ATS reads the form's notification email, so **field labels matter** (matching ignores case, punctuation and anything in parentheses). The full list of labels and accepted alternatives lives in `src/lib/ats/application.ts`. A field with a label the ATS doesn't recognize still shows on the profile under **Other answers**, so nothing is lost.

- **Keep sending from the same form.** The inbox poller only picks up submissions from `gv-clients.com` titled "Apply for a position" (or "Career Application"). A new form name or sender needs the poller's query updated.
- **Uploads** must be labelled starting with "Upload…" (e.g. *Upload Resume*, *Upload Cover Letter*). Files are only downloaded from `gv-clients.com` / `greendogdental.com`.
- **Address:** *City*, *State*, *ZIP Code*. **Pasted resume:** *Paste Resume*.
- **Multi-select answers** can arrive comma-separated or one per line.
- **Employment history:** *Employer 1*, *Job Title 1*, *Employer City 1*, *Start Date 1*, *End Date 1*, *Duties 1*, *Reason for Leaving 1*, *May We Contact 1* (then `2`, `3`).
- **References:** *Reference 1 Name*, *Reference 1 Relationship*, *Reference 1 Company*, *Reference 1 Phone*, *Reference 1 Email* (then `2`, `3`).
- **Languages:** *Languages Spoken*, plus an optional *&lt;Language&gt; Fluency* (e.g. *Spanish Fluency*).
- **Skills grids:** one field per skill, labelled with the skill (e.g. *Venipuncture*, *Multi-line Phones*), answered None / Learning / Competent / Can Train Others.
- **Per-ad links:** hidden fields *Source*, *Job ID*, *UTM Source*, *UTM Medium* and *UTM Campaign*, filled from the URL. Example: `…/apply?source=Indeed&job_id=VT-104`.

> Note: Indeed applications may also show up in the Review Queue directly from Indeed's notification emails. These often have **only a name and role**. If the person hasn't submitted the careers form yet, deny them or leave them pending (see Step 3). The auto-reply has already asked them to complete the form.

---

## Step 3 — Review Queue: Approve or Reject

**When:** Every business day by **[TIME, e.g. 11:00 AM]**. The goal is an **empty Review Queue** by end of day.
**Who:** The Daily Reviewer (backup: **[NAME]**).

1. Open **Ops → Recruiting (ATS) → Review Queue**. The banner shows how many applicants are waiting and flags anyone who has waited more than one business day.
2. Each card shows the **candidate name, role, location, 📎 resume, application date, ⭐ Candidate Score, source and status** (New / Re-applied). Expand a card for the full application.
3. Check the **Job**. Applications that match exactly one open job are linked automatically; otherwise pick the right open job.
4. Adjust the **⭐ score** if you like (click it — see *Candidate Score* below).
5. Choose:
   - **✓ Approve** — the candidate becomes a **New Lead**. Nothing is posted to Slack. Ops then asks for the next step:
     - **📝 Send Additional Form** — pick a role-specific questionnaire (forms tagged for the job are suggested first). The candidate gets an email with their own link; they then appear in **Form Responses**.
     - **📞 Schedule Phone Interview** or **👋 Schedule In-Person Interview** — send a scheduling link (Step 5).
     - **Skip & Continue**.
   - **✕ Reject** — see *Rejections* below.

**Approve if** they applied for an open role, their contact info and resume are there, and their experience and location meet the minimum. **Reject if** they don't meet the minimum, the application is incomplete, or it's a duplicate, spam or out of area.

---

## Step 4 — Form Responses: review the questionnaire

**Recruiting (ATS) → Form Responses** lists everyone sent an additional screening form: **candidate, role, location, ⭐ score, form sent, date sent, response status and date completed**.

- **Waiting for Response** — sent, not answered yet.
- **Completed — Needs Review** — answered; the tab badge counts these.
- **Reviewed** — hidden unless you tick *Show reviewed*.

Click a row to read their answers, then:
- **⭐ Adjust Score**
- **📞 Move to Phone Interview** or **👋 Skip → In-Person** — sends a scheduling link (Step 5)
- **📝 Send Another Form**
- **✕ Reject** — the 48-hour rejection process

Taking any of these marks the questionnaire **Reviewed**. (**✓ Mark reviewed** does it without taking an action.) Answers also stay on the candidate's **Forms** tab.

---

## Step 5 — Interviews

### Let the candidate pick a time (recommended)

1. Open the candidate → **Interview Tracking** → **📅 Invite to schedule**.
2. Choose the **interview type**, who it's **with** (**Me** or a **specific person**), the **duration**, the **date range** to offer, and where it is (phone, Zoom link or clinic). The dialog shows how many open times the candidate will see.
3. Click **Send Scheduling Link**. The candidate gets an email: *"Green Dog would like to schedule a 30-minute phone interview with you."* The link opens a calendar of the interviewer's open days. The candidate picks a day, then one of that day's open times. No account is needed. This works the same way for every interview type.
4. When the candidate picks a time and clicks **Confirm Interview**, Ops automatically:
   - adds the interview to **Interview Tracking** (Scheduled, with the interviewer) and to the **Ops calendar**;
   - puts it on the interviewer's **Google Calendar** and Google emails the candidate the invitation. If the interviewer hasn't connected Google, both get an email with a calendar file instead;
   - emails the candidate a confirmation and emails the interviewer a booking notice (with the calendar file when Google isn't connected);
   - **in-person interview or shadow:** creates the candidate's **first Slack announcement** (see *Slack* below). Phone screens, virtual interviews and doc calls stay inside Ops unless the candidate has already been announced, in which case they reply in the thread.

Open times come from each interviewer's **📅 My Availability** page (Recruiting header): weekly hours, interview length, a buffer between interviews and minimum notice, minus anything busy on their connected Google Calendar and any interviews already in Ops. **Connect your Google Calendar there once.** Ops only reads free/busy times and never imports your events. Only one scheduling link per interview type is live at a time; sending a new one cancels the old one. Pending links show on Interview Tracking with **Copy link** and **Cancel**.

### The Interviews queue

**Recruiting (ATS) → Interviews** is the working list for everyone actively interviewing. Each row shows the **candidate, role, preferred / assigned location, ⭐ score (editable), interview type, date / time, interviewer, interview status and current stage**.

- **Interview types:** Phone Screen, Virtual Interview, In-Person Interview, Shadow / Working Interview, Final Interview, Doc Call.
- **Statuses:** **Needs results** (the date has passed but it's still Scheduled — open it and log the grade, recommendation and status), **Scheduled**, **Awaiting booking** (scheduling link sent, with **Copy link**), and — when *Include completed* is ticked — **Completed** / **No show** from the last 30 days, with grade and recommendation.
- **Sort:** the list is in date and time order by default (interviews with no date, then links awaiting booking, come last). Click any column to sort by it instead. **Filter** by type, date, interviewer, role, location, score, stage and status; or tick **Only my interviews**.

The tab badge counts today's interviews plus those needing results. Check it first thing each day.

### Or log it yourself

1. In Slack, click **Open in GreenDogOps** on the announcement.
2. Review the candidate's profile, resume (Documents tab), and notes.
3. Go to the **Interview Tracking** tab and fill in **Schedule / log an interview**:
   - **Interview date** and **Start / End** time
   - **Type** (Phone Screen, Virtual, In-Person, Shadow / Working Interview, Final, Doc Call)
   - **Status:** *Scheduled*
   - **Interviewer:** your name
   - **Location** (phone, Zoom, clinic)
4. Click **Add interview**.

Saving a Scheduled interview puts it on the **Ops calendar**. An in-person interview or shadow also creates the first Slack announcement; anything else posts to Slack only once the candidate has been announced.

> **Before you schedule:** Check the candidate's Interview Tracking tab (and the Interviews queue) so we don't double-book them.

---

## Step 6 — After the interview: keep the candidate moving (existing process)

The interviewer owns the candidate until they hand them off or the process ends. Use the existing ATS tools:

1. **Log the result.** Open the interview on the **Interview Tracking** tab and set **Status** (Completed / No Show / Cancelled), **Overall grade** (A–F), **Recommendation** (Advance / Hold / Pass), and **Summary**. The **📋 interview guide** for the interview type loads automatically: the *Phone Screen* guide for phone and virtual interviews, the *In-Person / Shadow Day* guide for in-person interviews and shadow days, and the *Final Interview* guide for finals. Expand it to take notes question by question; every question is optional. You can pick a different guide or **No guide** from its dropdown. Answers are saved with the questions as they were, so later edits to a guide never change logged interviews.
2. **Share it.** Once the candidate has a Slack thread, marking the interview **Completed** posts 📝/✅ with ⭐ the grade and recommendation automatically. **Post summary** posts the full notes.
3. **Move the stage.** Update the candidate's **Stage**. Once announced, each stage change posts in their thread: ⬆️ when they advance, 💼 **Approved for Offer**, 🎉 **Hired**, ❌ passed / declined, ⏸️ on hold.
   `New Lead → Contacted → Phone Screen → Interview → Shadow Day → Offer → Hired`
   Closing stages: **Hold for Future · No Response · Passed · Declined**
4. **Set follow-ups.** Use **Tasks** and **Follow-up date** for next steps, and log calls/texts/emails in **Activity**.
5. **Hire.** When the offer is accepted, a manager clicks **Hire → Employee**. This sets the stage to **Hired**, moves the candidate to the HR roster with their job, and posts 🎉 in their Slack thread. If this hire fills the job's last opening, you're asked whether to close the job as **Filled**.

**Changing a candidate's job:** Use the **Job** dropdown in the All Candidates list or at the top of the candidate profile. Only open jobs are offered. Every change is recorded on the **History** tab and posted in the candidate's Slack thread.

---

## Team rules

- ✅ Every candidate goes through the **careers page form**. Send anyone who contacts us another way (walk-in, referral, text) to the form too.
- ✅ The **Review Queue is cleared every business day**.
- ✅ Early recruiting stays in Ops. Candidates are **announced in Slack automatically when an in-person interview or shadow is scheduled**.
- ✅ **Log every interview in the ATS.** That is what tells the team who is interviewing whom.
- ✅ Keep all discussion about a candidate **in their Slack thread**, not in new top-level posts.
- ❌ Don't keep candidate details in Indeed messages, personal email, or texts without logging them in the ATS.
- ❌ Don't delete candidates. Reject them, so we keep the history and recognize repeat applicants.

---

## Quick reference

| I need to… | Where |
|---|---|
| Open / close a job | Recruiting (ATS) → **Jobs** → **+ Job** / **Close job** / **Reopen** |
| See a job's candidates | **Jobs** → click the job's candidate count |
| See new applicants | Recruiting (ATS) → **Review Queue** |
| Approve / reject | Review Queue → pick the **Job** → **✓ Approve** / **✕ Reject** |
| Review questionnaire answers | Recruiting (ATS) → **Form Responses** → click the row |
| Adjust a candidate's score | Click the **⭐ score** anywhere it appears |
| Undo a rejection / cancel the email | Recruiting (ATS) → **Rejected** (or the banner on the profile) |
| Edit rejection emails | Recruiting (ATS) → **⚙ Settings** |
| Assign or move a candidate to a job | All Candidates or candidate profile → **Job** dropdown |
| Announce a candidate in Slack early | Candidate profile → **📣 Announce in Slack** |
| Launch an interview | Candidate profile → **Interview Tracking** → **Add interview** |
| Post interview results | Interview card → **Post summary** |
| Move a candidate forward | Candidate profile → **Stage** |
| Hire | Candidate profile → **Hire → Employee** |
| Send a questionnaire | Candidate profile → **Forms** → **📝 Send form** (or the Next Step after Accept) |
| See a candidate's answers | Candidate profile → **Forms** → click the form |
| Send a scheduling link | Candidate profile → **Interview Tracking** → **📅 Invite to schedule** |
| See all scheduled / pending interviews | Recruiting (ATS) → **Interviews** |
| Set my interview hours / connect Google | Recruiting → **📅 My Availability** |
| Create or edit a form | Recruiting → **Forms** → **+ Form** / **Edit** |
| Change interview questions | Recruiting → **Forms** → **Interview guides** → **Edit** |

---

## Slack: one candidate = one thread

**Nothing is posted** while a candidate is applying, being approved, filling in forms or doing phone screens — all of that stays in Ops.

**The first post** happens automatically when an **In-Person Interview** or **Shadow / Working Interview** is scheduled (by the candidate through a scheduling link, or logged by a recruiter):

```
👋 IN-PERSON CANDIDATE INTERVIEW
Jane Doe — CSR

📍 The Valley
📅 Tuesday, October 13
⏰ 2:00 PM
👤 Interviewing with Sarah
⭐ Candidate Score: 8.5/10

Current Process:
Application ✅
Screening Form ✅
Phone Interview ✅
In-Person Interview Scheduled ✅

Resume | Application | Open in GreenDogOps
```

(The checklist only lists steps they've completed. A shadow posts as 👥 SHADOW CANDIDATE.) **📣 Announce in Slack** on the profile posts it early if you need the team's eyes sooner.

**After that, every update replies in the same thread:**

| When this happens in Ops | Thread reply |
|---|---|
| In-person interview / shadow / other interview scheduled | 👋 IN-PERSON INTERVIEW SCHEDULED · 👥 SHADOW SCHEDULED · 📞/💻/🩺 … (date, time, location, with) |
| Interview marked Completed with a grade or recommendation | 📝 *Type* completed (✅ Shadow completed) · ⭐ Grade · Recommendation |
| Stage moved forward | ⬆️ *Candidate* advanced to *Stage* |
| Stage moved to Offer | 💼 APPROVED FOR OFFER — *Candidate* |
| Hire → Employee | 🎉 *Candidate* was hired |
| Rejected / passed / declined | ❌ *Candidate* moved to *Passed* / *Declined* |
| Questionnaire sent or completed, job changed | 📝 / ✅ / 💼 notes |
| **Post summary** clicked on an interview | Interview grade, recommendation and notes |

---

## Candidate Score

Every candidate has a **⭐ Candidate Score out of 10** (e.g. 8.5), shown in the Review Queue, Form Responses, Interviews, All Candidates, the candidate profile and the Slack announcement. Click it to change it — pick or type a score, add an optional note (e.g. *Phone interview*), **Save score**. Every change keeps who, when and the note; the history is listed under the score. (Scores from the old spreadsheet's 0–5 scale were doubled onto the 10-point scale.)

---

## Rejections

Click **✕ Reject** in the Review Queue, Form Responses or on the profile. Ops asks:

> **Send rejection email automatically in 48 hours?** ✅ (default) — **Template:** *Initial Application Rejection* ▼ — **Confirm Rejection**

The template is suggested from where they were rejected (Initial Application / Post-Screening / Post-Interview). Rejecting moves them to **Declined** (from the Review Queue) or **Passed**, cancels any open questionnaire or scheduling link and upcoming interviews, and puts them in **Recruiting (ATS) → Rejected**:

| Column | |
|---|---|
| Candidate, Role, Stage Rejected From, Rejected By, Rejection Date | |
| Email Scheduled For | with a countdown while waiting |
| Email Template, Email Status | **Waiting — 48 Hours**, **Email Sent**, **Email Cancelled**, **No email**, **Email failed** |

Until the email goes out, anyone who can edit Recruiting can **Cancel email** (they stay rejected) or **Undo rejection** (they go back exactly where they were — the Review Queue or their previous stage — and no email is sent; cancelled links and interviews stay cancelled). The same controls show in a banner on the candidate's profile. Emails are sent by Ops every 15 minutes once the 48 hours are up; if someone moved the candidate to another stage in the meantime, the email is skipped.

**Templates:** **Recruiting (ATS) → ⚙ Settings → Rejection Templates** — add or edit templates (name, subject, message) and preview them. Use `{first_name}`, `{full_name}` and `{role}`; the "— The Green Dog Team" sign-off is added automatically.

---

## Forms (Recruiting → Forms)

Our recruiting version of Google Forms. There are three kinds:

- **Standard Application** — the public application linked from job postings (`/apply`, or `/apply/<link name>` for extra versions). Contact details, position, city/ZIP, resume and cover letter are built in; you add the standard questions. One application is the **Default** served at `/apply`.
- **Role-specific forms** — questionnaires sent to one candidate at a time. Tag each with the job types it's for (e.g. CSR) so it's suggested first for those candidates. These replace the questions we used to send in Indeed auto-responses:

  | Form | Suggested for |
  |---|---|
  | Vet Tech Screening Questions (Lead / Senior Vet Tech) | Senior Vet Tech, Vet Tech, RVT, Clinic Tech |
  | In-House CSR Screening Questions | CSR |
  | Remote CSR Screening Questions | Remote CSR |
  | Remote CSR Written Exercise (replies to 3 mock client emails and 3 mock texts) | Remote CSR |
  | Non-Anesthetic Dental Tech Screening Questions | Dental Tech, Dentals (trainee) |

- **Interview guides** — the question sets interviewers fill in on **Interview Tracking** (see Step 6). Tag each with the interview types it loads for and, optionally, job types. A guide tagged with the candidate's job wins over a general one. Candidates never see guides. The starting guides are *Phone Screen* (from our In-House CSR interview template), *In-Person / Shadow Day* (with 1–5 ratings for our core values) and *Final Interview*.

In the builder, questions can be **Short answer, Paragraph, Multiple choice, Checkboxes, Dropdown, Yes / No, Number, Date, File upload** (not in interview guides) or a **Section heading**, each **Required** or optional. In an interview guide, a question's description shows as a 💡 tip for the interviewer. You can reorder, duplicate and delete them. On the Forms tab you can **Edit, Preview, Duplicate, Activate / Deactivate**, make an application the **Default**, and copy an application's link. Editing a form never changes answers already submitted; each response keeps the questions as they were.

---

## Setup for admins: Google Calendar sign-in

Interviewers connect their own Google Calendar from **📅 My Availability**. This needs a one-time setup in Google Cloud:

1. In the Google Cloud project used for Ops, enable the **Google Calendar API**.
2. Create (or reuse) an **OAuth client ID** of type **Web application**. Add the authorized redirect URI `https://<ops domain>/api/ats/google/callback` (the exact URI is shown on the My Availability page).
3. On the OAuth consent screen, add the scopes `calendar.events` and `calendar.freebusy`, and publish the app ("In production"), so connections don't expire after 7 days.
4. Set `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` and `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` in Vercel. Without them, Ops falls back to `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`.

Candidate emails go out through Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`). Outlook calendars are planned for a later phase.

## Texting candidates

Open the candidate → **Texts** tab. You can text a candidate who ticked *"I agree to receive texts and emails about my application"* on the Green Dog application. For anyone else (for example Indeed applicants), get their OK first, then choose how they agreed and click **Record consent**. Ops adds "Green Dog:" to the start of every text and "Reply STOP to opt out." to the first one. Texts only go out 8 AM–9 PM Pacific. If someone replies STOP, Ops won't text them again unless they reply START. When a candidate replies, you get an email and the reply shows in the Texts tab. Employees have the same **Texts** tab on their HR profile (HR roles only). Their consent must be recorded by HR, because the application's checkbox only covers texts about the application.

