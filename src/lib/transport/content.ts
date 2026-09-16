import { customerProvider } from "./index";
import { isMetaCloudConfigured } from "./meta-api";
import {
  createMetaTemplate,
  listMetaTemplatesWithStatus,
} from "./meta-content";
import {
  createTemplate as createTwilioTemplate,
  isContentApiConfigured as isTwilioContentConfigured,
  listTemplatesWithStatus as listTwilioTemplatesWithStatus,
  submitForApproval as submitTwilioForApproval,
} from "./twilio-content";
import type {
  CreateTemplateInput,
  CreatedTemplate,
  TemplateCategory,
  TemplateSummary,
} from "./twilio-content";

export type {
  ApprovalStatus,
  ContentType,
  CreateTemplateInput,
  CreatedTemplate,
  CtaButton,
  QuickReplyButton,
  TemplateCategory,
  TemplateSummary,
} from "./twilio-content";

export function isContentApiConfigured(): boolean {
  return customerProvider() === "meta"
    ? isMetaCloudConfigured()
    : isTwilioContentConfigured();
}

export function listTemplatesWithStatus(): Promise<TemplateSummary[]> {
  return customerProvider() === "meta"
    ? listMetaTemplatesWithStatus()
    : listTwilioTemplatesWithStatus();
}

export function createTemplate(input: CreateTemplateInput): Promise<CreatedTemplate> {
  return customerProvider() === "meta"
    ? createMetaTemplate(input)
    : createTwilioTemplate(input);
}

export function submitForApproval(
  contentSid: string,
  name: string,
  category: TemplateCategory,
): Promise<{ status: string }> {
  // Creating a template through Meta submits it immediately. This preserves
  // the route's create-then-submit contract without attempting a second API.
  return customerProvider() === "meta"
    ? Promise.resolve({ status: "pending" })
    : submitTwilioForApproval(contentSid, name, category);
}
