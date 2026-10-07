# Green Dog Recruiting Workflow — How We Use the Ops ATS

**Audience:** Everyone who posts jobs, reviews applicants, or interviews candidates.
**Goal:** Every candidate goes into one system (the Ops ATS) in the same format, with full contact details and resume attached, so anyone on the team can pick up a candidate and move them forward.

---

## The workflow at a glance

```
 Indeed ad ──► Auto-reply ──► Careers page form ──► Ops ATS "Review Queue"
                                                          │
                                         Daily review: Approve or Deny
                                                          │
                              ┌───────────────────────────┴──────────────┐
                           APPROVE                                     DENY
                              │                                          │
             Slack (automatic): ✅ candidate summary +          Marked "Declined"
             link to their Ops ATS profile                      (kept on file)
                              │
          Team member opens the profile → launches the interview
                              │
          Slack (same thread, automatic): "☎️/👋 <Interviewer> is interviewing <Candidate>"
                              │
          Interviewer moves the candidate through the normal pipeline
          (⭐ stage changes → 💼 offer → 🎉 Hire — each posted automatically)
```

**The rule:** If a candidate isn't in the Ops ATS, they aren't in our process. We don't track candidates in Indeed, email, or text threads.

---

## Roles

| Role | Responsibility |
|---|---|
| **Job Poster** (Recruiting lead) | Posts and maintains Indeed ads and makes sure every ad has the auto-reply turned on. |
| **Daily Reviewer** | Clears the ATS Review Queue every business day by approving or denying each applicant. |
| **Interviewer** (anyone with ATS edit access) | Picks up approved candidates from Slack, launches the interview, and moves them forward. |
| **Hiring Manager / Admin** | Makes final decisions, sends offers, and clicks **Hire → Employee**. |

---

## Step 1 — Post the ad on Indeed (with auto-reply)

Indeed is our main source of candidates. Indeed applications usually arrive **without** a phone number, email, or resume. That's why every candidate must also apply through our careers page.

**For every Indeed ad:**

1. Post the ad as normal (title, location, pay, schedule).
2. Turn on an **automatic reply/message** to every applicant that sends them to our careers page form. Use the template below.
3. Use the **same position title** in the ad as on the careers form's "Role Applying For" list, so candidates line up with the right position in the ATS.
4. Each time you create or repost an ad, check that the auto-reply is still on.

**Auto-reply template (copy/paste):**

> Hi {first name},
>
> Thanks for applying to **{position}** at Green Dog! To be considered, please complete our short application on our careers page:
>
> 👉 **[CAREERS PAGE LINK]**
>
> Please attach your resume. The form takes about 3 minutes. We review new applications every business day and will reach out if you're a fit.
>
> — The Green Dog Team

> ⚠️ Replace `[CAREERS PAGE LINK]` with the live careers form URL before turning the auto-reply on.

---

## Step 2 — Candidate completes the careers page form → lands in the ATS automatically

The careers page form is connected to the Ops ATS. You don't need to do anything here.

- When a candidate submits the form, the submission goes to the careers inbox. **About every 5 minutes**, the ATS pulls it in and creates a candidate profile.
- The profile includes: **Name, Email, Phone, Role Applying For, Practice/Location, Cover letter/notes, Source = "GD Website",** and the **uploaded resume** (PDF/Word/image), downloaded from the form and saved on the candidate's Documents tab.
- **Repeat applicants** are recognized automatically and added to their existing profile, so we don't get duplicates.
- Every new applicant starts in **Recruiting (ATS) → Review Queue** with status *Pending*.

**What the careers form must collect** (so the Review page has everything):

| Field | Required |
|---|---|
| Name | ✅ |
| Email | ✅ |
| Phone Number | ✅ |
| Role Applying For | ✅ |
| Practice/Location | ✅ |
| Resume (file upload) | ✅ |
| Cover Letter / Notes | Optional |

> Note: Indeed applications may also show up in the Review Queue directly from Indeed's notification emails. These often have **only a name and role**. If the person hasn't submitted the careers form yet, deny them or leave them pending (see Step 3). The auto-reply has already asked them to complete the form.

---

## Step 3 — Daily review: Approve or Deny

**When:** Every business day by **[TIME, e.g. 11:00 AM]**. The goal is an **empty Review Queue** by end of day.
**Who:** The Daily Reviewer (backup: **[NAME]**).

1. Open **Ops → Recruiting (ATS) → Review Queue**.
2. For each applicant, check the name, contact info, role, location, and resume.
3. Choose one:
   - **✓ Accept (Approve):** The candidate meets the basic requirements for the role. They move into the pipeline as **New Lead** and are **announced in Slack automatically** (Step 4).
   - **✕ Reject (Deny):** The candidate isn't a fit, the application is incomplete, or it's spam. They're marked **Declined** and **kept on file**, so we'll recognize them if they apply again.

**Approve if:**
- They applied for an open role, and
- Their contact info and resume are there, and
- Their experience and location meet the minimum for the role.

**Deny if:**
- Contact info or resume is missing, and they haven't completed the careers form, or
- They clearly don't meet the minimum requirements, or
- It's a duplicate, spam, or an out-of-area application.

---

## Step 4 — Approved candidates are announced in Slack (automatic)

Clicking **✓ Accept** automatically posts the candidate to the **Slack hiring channel**. This is how the rest of the team finds out a new candidate is ready. Nobody needs to write a Slack post.

The Slack post looks like this:

```
@channel ✅ NEW (CSR) CANDIDATE ANNOUNCEMENT
1. NOTES: …
2. NAME: Jane Doe
3. PHONE: (555) 555-5555
4. EMAIL: jane@example.com
5. LOCATION: Sherman Oaks
6. RESUME & INT LINK: Resume · Open in GreenDogOps
```

- **"Open in GreenDogOps"** links straight to the candidate's Ops ATS profile.
- If an announcement ever fails (or a candidate was added to the pipeline some other way), open their profile and click **📣 Announce in Slack**. Once a candidate is announced, the button shows **Announced ✓**.
- Each candidate is announced **once**. All later updates (interviews, stage changes, summaries) are posted **as replies in that same Slack thread**, so the whole history stays together.

---

## Step 5 — Launch the interview (posts to Slack)

**Anyone with ATS access** can pick up an announced candidate.

1. In Slack, click **Open in GreenDogOps** on the announcement.
2. Review the candidate's profile, resume (Documents tab), and notes.
3. Go to the **Interview Tracking** tab and fill in **Schedule / log an interview**:
   - **Interview date** and **Start / End** time
   - **Type** (Phone Screen, In-Person Interview, Working Interview / Shadow Day, Final)
   - **Status:** *Scheduled*
   - **Interviewer:** your name
   - **Location** (phone, Zoom, clinic)
4. Click **Add interview**.

Saving the interview automatically:
- posts a reply in the candidate's Slack thread saying who is interviewing them and when, for example:
  ```
  ☎️ Phone Screen scheduled — Jane Doe
  Sarah is interviewing Jane Doe · Wed, Oct 7 · 10:00 AM–10:30 AM · Zoom
  ```
  In-person interviews and shadow days post with 👋 instead of ☎️.
- puts the interview on the **Ops calendar**.

> **Before you launch:** Check the Slack thread first. If someone else has already posted an interview for this candidate, coordinate with them. Don't double-book the candidate.

---

## Step 6 — After the interview: keep the candidate moving (existing process)

The interviewer owns the candidate until they hand them off or the process ends. Use the existing ATS tools:

1. **Log the result.** Open the interview on the **Interview Tracking** tab and set **Status** (Completed / No Show / Cancelled), **Overall grade** (A–F), **Recommendation** (Advance / Hold / Pass), and **Summary**. The CSR phone-screen questions are available for phone screens.
2. **Share it.** Click **Post summary** to post the interview results in the candidate's Slack thread.
3. **Move the stage.** Update the candidate's **Stage**. Each stage change is also posted to the Slack thread automatically: ⭐ when they advance, 💼 when they move to **Offer**, and 🚫/⏸️ when they're passed or put on hold.
   `New Lead → Contacted → Phone Screen → Zoom/Virtual Interview → In-Person / Shadow Day → Doc Call → Offer → Hired`
   Closing stages: **Hold for Future · No Response · Passed · Declined**
4. **Set follow-ups.** Use **Tasks** and **Follow-up date** for next steps, and log calls/texts/emails in **Activity**.
5. **Hire.** When the offer is accepted, a manager clicks **Hire → Employee**. This moves the candidate to the HR roster and posts 🎉 in their Slack thread.

---

## Team rules

- ✅ Every candidate goes through the **careers page form**. Send anyone who contacts us another way (walk-in, referral, text) to the form too.
- ✅ The **Review Queue is cleared every business day**.
- ✅ Every approved candidate is **announced in Slack automatically**, with the profile link.
- ✅ **Log every interview in the ATS.** That is what tells the team who is interviewing whom.
- ✅ Keep all discussion about a candidate **in their Slack thread**, not in new top-level posts.
- ❌ Don't keep candidate details in Indeed messages, personal email, or texts without logging them in the ATS.
- ❌ Don't delete candidates. Decline them, so we keep the history and recognize repeat applicants.

---

## Quick reference

| I need to… | Where |
|---|---|
| See new applicants | Recruiting (ATS) → **Review Queue** |
| Approve / deny | Review Queue → **✓ Accept** (also posts to Slack) / **✕ Reject** |
| Re-send a Slack announcement | Candidate profile → **📣 Announce in Slack** |
| Launch an interview | Candidate profile → **Interview Tracking** → **Add interview** |
| Post interview results | Interview card → **Post summary** |
| Move a candidate forward | Candidate profile → **Stage** |
| Hire | Candidate profile → **Hire → Employee** |

---

## What posts to Slack automatically

| When this happens in Ops | Slack shows |
|---|---|
| Applicant accepted from the Review Queue | ✅ NEW CANDIDATE ANNOUNCEMENT (summary + resume + profile link) |
| Phone screen logged as Scheduled | ☎️ Phone Screen scheduled — *Interviewer* is interviewing *Candidate* · date · time |
| In-person interview / shadow day logged as Scheduled | 👋 … scheduled — *Interviewer* is interviewing *Candidate* · date · time |
| Stage moved forward | ⭐ *Candidate* advanced to *Stage* |
| Stage moved to Offer | 💼 *Candidate* approved for an offer |
| Hire → Employee | 🎉 *Candidate* was hired |
| **Post summary** clicked on an interview | Interview grade, recommendation, and notes |

Everything after the announcement is posted as a reply in that candidate's thread.
