"use client";

import { useActionState } from "react";
import type { CrmInfluencer } from "@/lib/crm/types";
import { updateInfluencer, type SaveResult } from "../../actions";
import {
  Field,
  TextArea,
  Checkbox,
  Section,
  SaveButton,
} from "../../form-fields";

function influencerHeading(i: CrmInfluencer): string {
  if (i.contact_name && i.contact_name !== "-") return i.contact_name;
  if (i.pet_name) return i.pet_name;
  if (i.instagram_handle) return `@${i.instagram_handle}`;
  return "Influencer";
}

export function InfluencerForm({ influencer }: { influencer: CrmInfluencer }) {
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => updateInfluencer(influencer.id, prev, fd),
    null,
  );

  const i = influencer;

  return (
    <form action={formAction} className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {influencerHeading(i)}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Influencer · {i.tier ?? "untiered"}
            {i.status ? ` · ${i.status}` : ""}
          </p>
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          {result?.ok === true && (
            <span className="text-sm text-emerald-700">Saved ✓</span>
          )}
          {result?.ok === false && (
            <span className="text-sm text-red-600">{result.error}</span>
          )}
          <SaveButton />
        </div>
      </div>

      <Section title="Contact">
        <Field label="Contact name" name="contact_name" defaultValue={i.contact_name} />
        <Field label="Pet name" name="pet_name" defaultValue={i.pet_name} />
        <Field label="Email" name="email" type="email" defaultValue={i.email} />
        <Field label="Phone" name="phone" defaultValue={i.phone} />
        <Field label="Location" name="location" defaultValue={i.location} />
        <Field label="Status" name="status" defaultValue={i.status} />
        <Field label="Tier" name="tier" defaultValue={i.tier} />
        <Field label="Priority" name="priority" defaultValue={i.priority} />
        <Field label="Content niche" name="content_niche" defaultValue={i.content_niche} />
      </Section>

      <Section title="Social">
        <Field label="Instagram handle" name="instagram_handle" defaultValue={i.instagram_handle} />
        <Field label="Instagram URL" name="instagram_url" defaultValue={i.instagram_url} />
        <Field label="TikTok handle" name="tiktok_handle" defaultValue={i.tiktok_handle} />
        <Field label="YouTube URL" name="youtube_url" defaultValue={i.youtube_url} />
        <Field label="Facebook URL" name="facebook_url" defaultValue={i.facebook_url} />
        <Field label="Pet Instagram" name="pet_instagram" defaultValue={i.pet_instagram} />
        <Field label="Highest platform" name="highest_platform" defaultValue={i.highest_platform} />
        <Field label="Total followers" name="follower_count" type="number" defaultValue={i.follower_count} />
        <Field label="Engagement rate (%)" name="engagement_rate" type="number" defaultValue={i.engagement_rate} />
        <Field label="Instagram followers" name="instagram_followers" type="number" defaultValue={i.instagram_followers} />
        <Field label="TikTok followers" name="tiktok_followers" type="number" defaultValue={i.tiktok_followers} />
        <Field label="YouTube subscribers" name="youtube_subscribers" type="number" defaultValue={i.youtube_subscribers} />
        <Field label="Facebook followers" name="facebook_followers" type="number" defaultValue={i.facebook_followers} />
      </Section>

      <Section title="Audience">
        <Field label="Age range" name="audience_age_range" defaultValue={i.audience_age_range} />
        <Field label="Gender split" name="audience_gender_split" defaultValue={i.audience_gender_split} />
        <Field label="Location" name="audience_location" defaultValue={i.audience_location} />
      </Section>

      <Section title="Pet">
        <Field label="Pet type" name="pet_type" defaultValue={i.pet_type} />
        <Field label="Pet breed" name="pet_breed" defaultValue={i.pet_breed} />
        <Field label="Pet age" name="pet_age" defaultValue={i.pet_age} />
      </Section>

      <Section title="Agreement & Compensation">
        <Field label="Collaboration type" name="collaboration_type" defaultValue={i.collaboration_type} />
        <Field label="Promo code" name="promo_code" defaultValue={i.promo_code} />
        <Field label="EzyVet tracking" name="ezyvet_tracking" defaultValue={i.ezyvet_tracking} />
        <Field label="Compensation type" name="compensation_type" defaultValue={i.compensation_type} />
        <Field label="Compensation rate" name="compensation_rate" type="number" defaultValue={i.compensation_rate} />
        <Field label="Commission (%)" name="commission_percentage" type="number" defaultValue={i.commission_percentage} />
        <Field label="Total paid" name="total_paid" type="number" defaultValue={i.total_paid} />
        <Field label="Total value generated" name="total_value_generated" type="number" defaultValue={i.total_value_generated} />
        <Field label="Contract start" name="contract_start_date" type="date" defaultValue={i.contract_start_date} />
        <Field label="Contract end" name="contract_end_date" type="date" defaultValue={i.contract_end_date} />
        <TextArea label="Agreement details" name="agreement_details" defaultValue={i.agreement_details} />
      </Section>

      <Section title="Activity & Performance">
        <Field label="Posts completed" name="posts_completed" type="number" defaultValue={i.posts_completed} />
        <Field label="Stories completed" name="stories_completed" type="number" defaultValue={i.stories_completed} />
        <Field label="Reels completed" name="reels_completed" type="number" defaultValue={i.reels_completed} />
        <Field label="Events attended" name="events_attended" type="number" defaultValue={i.events_attended} />
        <Field label="Relationship status" name="relationship_status" defaultValue={i.relationship_status} />
        <Field label="Relationship score" name="relationship_score" type="number" defaultValue={i.relationship_score} />
        <Field label="Last post date" name="last_post_date" type="date" defaultValue={i.last_post_date} />
        <Field label="Last contact date" name="last_contact_date" type="date" defaultValue={i.last_contact_date} />
        <Field label="Next follow-up" name="next_followup_date" type="date" defaultValue={i.next_followup_date} />
        <Checkbox label="Needs follow-up" name="needs_followup" defaultChecked={i.needs_followup} />
      </Section>

      <Section title="Notes">
        <TextArea label="Bio" name="bio" defaultValue={i.bio} />
        <TextArea label="Notes" name="notes" defaultValue={i.notes} />
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-md sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-8 sm:pt-0">
        {result?.ok === true && (
          <span className="text-sm text-emerald-700">Saved ✓</span>
        )}
        {result?.ok === false && (
          <span className="text-sm text-red-600">{result.error}</span>
        )}
        <SaveButton />
      </div>
    </form>
  );
}
