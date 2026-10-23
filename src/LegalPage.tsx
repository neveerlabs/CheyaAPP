import { Bug } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BugReportDialog } from "./components/BugReportDialog";
import type { AccountRole, AppSupabaseClient } from "./lib/supabase";

export type LegalPageKind = "privacy" | "terms";

const contactEmail = "neverlabs4@gmail.com";

type LegalPageReporter = {
  client: AppSupabaseClient;
  accountUserId: string;
  accountEmail: string | null;
  accountProvider: "google" | "github";
  githubUsername: string | null;
  accountRole: AccountRole;
};

export function LegalPage({
  kind,
  reporter,
}: {
  kind: LegalPageKind;
  reporter?: LegalPageReporter;
}) {
  const isPrivacy = kind === "privacy";
  const title = isPrivacy ? "Privacy Policy" : "Terms of Service";
  const [isBugReportOpen, setIsBugReportOpen] = useState(false);

  useEffect(() => {
    document.title = `${title} | CheyaAPP`;
  }, [title]);

  return (
    <main className="fixed inset-0 overflow-y-auto overscroll-contain bg-white px-5 py-8 text-[#27282d] sm:px-8 sm:py-12">
      <article className="mx-auto max-w-5xl">
        <LegalPageContent kind={kind} />

        <footer className="mt-2 flex flex-col items-center gap-3 border-t border-[#e7e8eb] px-1 py-6 text-center text-sm">
          <a href="/" className="font-medium text-[#356d91] hover:underline">
            Back to home
          </a>
          <nav aria-label="Legal information" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <a href="/privacy" className="text-[#5f626a] hover:text-[#25262a] hover:underline">
              Privacy
            </a>
            <a href="/terms" className="text-[#5f626a] hover:text-[#25262a] hover:underline">
              Terms
            </a>
            <a href={`mailto:${contactEmail}`} className="text-[#5f626a] hover:text-[#25262a]">
              {contactEmail}
            </a>
            {reporter && (
              <button
                type="button"
                aria-label="Report a problem"
                onClick={() => setIsBugReportOpen(true)}
                className="inline-flex items-center gap-1.5 text-[#5f626a] hover:text-[#25262a]"
              >
                <Bug aria-hidden="true" className="size-4" />
                Report a problem
              </button>
            )}
          </nav>
        </footer>
      </article>
      {reporter && (
        <BugReportDialog
          open={isBugReportOpen}
          onClose={() => setIsBugReportOpen(false)}
          onDiscard={() => setIsBugReportOpen(false)}
          {...reporter}
        />
      )}
    </main>
  );
}

export function LegalPageContent({ kind }: { kind: LegalPageKind }) {
  const isPrivacy = kind === "privacy";
  const title = isPrivacy ? "Privacy Policy" : "Terms of Service";
  return (
    <>
      <header className="border-b border-[#e7e8eb] px-1 pb-8 sm:pb-10">
        <h2 className="text-xl font-semibold tracking-tight text-[#202126] sm:text-2xl">
          {title}
        </h2>
        <p className="mt-2 text-sm text-[#777a82]">Effective October 22, 2026</p>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-[#5f626a] sm:text-base sm:leading-8">
          {isPrivacy
            ? "This policy explains what information is processed when you use CheyaAPP, how it is used, and the choices available to you."
            : "These terms govern your use of CheyaAPP. By using the service, you agree to the following terms."}
        </p>
      </header>
      {isPrivacy ? <PrivacyPolicy /> : <TermsOfService />}
    </>
  );
}

function PolicySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-b border-[#e7e8eb] py-7 last:border-b-0 sm:grid-cols-[minmax(190px,0.32fr)_minmax(0,1fr)] sm:gap-10 sm:py-8">
      <h2 className="text-base font-semibold text-[#25262a]">{title}</h2>
      <div className="space-y-4 text-sm leading-7 text-[#5f626a] sm:text-base sm:leading-8">
        {children}
      </div>
    </section>
  );
}

function PrivacyPolicy() {
  return (
    <div>
      <PolicySection title="Information we process">
        <p>
          When you sign in, Google or GitHub and Supabase process the account information needed to
          authenticate you, such as your account identity and email address. CheyaAPP associates
          service data with your Supabase account ID.
        </p>
        <p>
          Google and GitHub sign-in are used for authentication. CheyaAPP does not request access to
          Gmail, Google Drive, contacts, or other Google content.
        </p>
        <p>
          The service stores content you create or send, including messages, AI replies, message
          versions and conversation branches, attachments, feedback, personalization settings,
          conversation insights, and long-term memories. Insights may describe communication style,
          topics, mood, situation, or support needs based on messages. If you add Gemini or Gemini
          TTS API keys, they are stored so the corresponding AI or speech features can use them.
        </p>
        <p>
          To show active sign-ins, CheyaAPP stores a session identifier, browser and device
          information, the site origin and current path, and session start and last-active times.
          Query strings and URL fragments are not stored. Inactive session records are removed after
          30 days.
        </p>
        <p>
          Your browser may store your sign-in session and unsent message or attachment drafts so
          they can be restored after a page reload. Drafts are stored on that device and may remain
          there until removed or browser site data is cleared, including after account deletion.
        </p>
        <p>
          Bug reports, including their descriptions and any attached photos or videos, are sent by
          email to our support mailbox and are not stored in the CheyaAPP database or file storage.
          The report includes your account ID, sign-in provider, and role; your verified email may
          be used as the reply address. Unsent report drafts are kept locally in your browser until
          email delivery succeeds and the draft is cleared. The email provider and recipient mailbox
          retain delivered reports according to their own policies.
        </p>
        <p>
          New accounts may receive one transactional welcome email at their verified sign-in email
          address. Existing accounts do not receive this message.
        </p>
        <p>
          If you enable push notifications, the service stores the browser push subscription for
          that account and device. Chat-related reminders and service notifications may also be
          stored in your account inbox.
        </p>
      </PolicySection>

      <PolicySection title="How information is used and shared">
        <p>
          Data is used to provide chat, synchronize account data and settings, process attachments,
          generate AI replies and speech, provide search and reminder features, and maintain
          service security and reliability. The service may analyze relevant messages to create
          conversation insights and retrieve relevant messages or saved memories for a reply.
          Conversation context and insights follow the active conversation branch. We do not sell
          personal data or use conversations for advertising.
        </p>
        <p>
          CheyaAPP uses Supabase for authentication, database, and file storage; Vercel for
          application hosting and processing; Google and GitHub for sign-in, Google for Gemini AI;
          Cloudflare Turnstile for sign-in security checks; and third-party search providers when
          web search is used. Search queries and requested public pages may be processed by those
          providers. These providers process information under their own terms and privacy policies.
        </p>
        <p>
          Messages, relevant conversation context, and attachments you select may be sent to Google
          Gemini using the Gemini API key configured for the account so the model can respond or
          perform a requested feature. When an AI action sends a push notification, creates a
          reminder, searches personal records, or shares information with an administrator, the
          information needed for that action is processed by the app. Content is shared with an
          administrator only when you request an applicable forwarding or messaging action.
        </p>
        <p>
          When you request spoken output, Gemini TTS is used with your configured TTS keys when
          available. If no TTS key is configured or Gemini TTS fails, the selected message text is
          sent to Sound of Text to generate speech with its Google voice service. If remote speech
          generation is unavailable, your browser may use an installed speech voice locally.
          Browser-generated audio is not uploaded to CheyaAPP. Sound of Text and Gemini audio are
          privately cached for 24 hours.
        </p>
        <p>
          If you use your own API keys, requests made with those keys may be billed or otherwise
          subject to limits set by the relevant provider. CheyaAPP does not control those provider
          practices.
        </p>
      </PolicySection>

      <PolicySection title="Retention and deletion">
        <p>
          Attachments are stored privately and are no longer available after their retention period,
          at most 24 hours after upload. The cleanup process removes expired files and their
          attachment metadata; technical delays may affect when cleanup completes. The web upload
          limit is 18 MB per file, including the source file; a message may contain up to 10 files
          with a combined limit of 50 MB. Files that cannot be processed within those limits are not
          sent.
        </p>
        <p>
          Messages, versions, branches, insights, memories, settings, and feedback are not covered
          by the 24-hour attachment retention period. They remain stored until you delete them
          using available features or contact us to request deletion. Clear chats removes messages,
          their versions and branches, and related insights and feedback while preserving
          long-term memories, settings, and API keys. Deleting an attachment does not automatically
          delete its related message or insight. Sound of Text and Gemini speech audio are privately
          cached for up to 24 hours; browser-generated speech is not saved by CheyaAPP.
        </p>
        <p>
          Deleting your account removes its Supabase account and associated app data, including
          messages, branches, insights, memories, settings, sessions, push subscriptions, inbox
          items, and stored files. Gemini and TTS API key values are retained in the database
          without an account link and are no longer available to the deleted account. Unsent drafts
          stored in a browser are not removed by server-side account deletion; clear CheyaAPP site
          data on each device to remove them. Account deletion also signs out the current browser;
          other devices may retain an already-issued access token until it expires.
        </p>
        <p>
          For questions or requests about your account data, contact{" "}
          <a className="font-medium text-[#356d91] hover:underline" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
          . We may need to verify that a request comes from the account owner.
        </p>
      </PolicySection>

      <PolicySection title="Security and changes">
        <p>
          We use account authentication, access controls, and data restrictions to help protect
          information. No electronic storage or transmission method can be guaranteed completely
          secure. Keep your sign-in method and API keys private, and notify us if you believe your
          account has been accessed without permission.
        </p>
        <p>
          This policy may be updated when the service or applicable obligations change. The latest
          version and its effective date will be published on this page.
        </p>
      </PolicySection>
    </div>
  );
}

function TermsOfService() {
  return (
    <div>
      <PolicySection title="Using the service">
        <p>
          CheyaAPP provides an AI conversation workspace with chat history and branches,
          personalization, conversation insights and saved memories, file attachments, search,
          speech generation, reminders, and notifications. Features may depend on your settings,
          configured API keys, browser, and third-party availability. You are responsible for
          protecting access to your account and any API keys you add.
        </p>
        <p>
          You may only submit content you have the right to use. Do not use the service to violate
          the law, infringe another person&apos;s rights, send unsolicited or abusive content,
          interfere with the service, bypass access controls, or compromise its security or
          availability.
        </p>
        <p>
          You are responsible for reviewing messages and files before sending them to the AI or
          using an AI action that searches, stores, shares, or sends information. Use Clear chats
          or account deletion only when you intend to remove the data described in the Privacy
          Policy.
        </p>
      </PolicySection>

      <PolicySection title="AI features and third-party services">
        <p>
          CheyaAPP is an AI service. Responses, insights, search results, memories, speech, and
          reminders may be incorrect, incomplete, delayed, or out of context. They are not
          professional, medical, legal, financial, or emergency advice. Consult an appropriate
          qualified professional for important decisions and do not rely on the service for
          emergency assistance.
        </p>
        <p>
          AI requests may include relevant messages, active-branch context, insights, selected
          memories, and files you attach. Your configured Gemini API keys may be used for AI and
          speech features. You are responsible for any charges, quotas, and provider terms that
          apply to your keys. Sign-in, hosting, database, file storage, search, push delivery, and
          speech generation depend on third-party services and are also subject to their terms.
        </p>
      </PolicySection>

      <PolicySection title="Content and attachments">
        <p>
          You retain your rights to content you submit. You grant CheyaAPP permission to store and
          process that content as needed to provide the features you use, including chat, AI
          processing, search, speech, insights, temporary processing, and service security and
          reliability.
        </p>
        <p>
          The upload limit is 18 MB per file, including before processing, and 50 MB total across
          up to 10 files in one message. Files that cannot be processed within the 18 MB per-file
          limit while preserving usable quality are rejected. Attachments are stored privately for
          at most 24 hours and scheduled for deletion; related messages and conversation data remain
          until deleted separately.
        </p>
        <p>
          You are responsible for ensuring that you have permission to upload and process files
          and that they do not contain material you are not authorized to share with the selected
          AI provider or other services used for the feature.
        </p>
      </PolicySection>

      <PolicySection title="Account and data controls">
        <p>
          You may clear chat history while preserving long-term memories, settings, and API keys.
          Account deletion permanently removes the account and its associated app data. Gemini and
          TTS API key values are retained in the database without an account link after deletion;
          they are not available to the deleted account. Browser-stored unsent drafts may remain on
          your devices until you clear CheyaAPP site data there.
        </p>
      </PolicySection>

      <PolicySection title="Availability, changes, and contact">
        <p>
          We work to keep the service available but do not guarantee that it will always be
          uninterrupted or error-free. Features may be updated, changed, or discontinued.
        </p>
        <p>
          These terms may be updated by publishing a revised version on this page. For questions
          about these terms or account requests, contact{" "}
          <a className="font-medium text-[#356d91] hover:underline" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
          .
        </p>
        <p>
          These terms do not limit consumer rights that cannot be waived under applicable law.
        </p>
      </PolicySection>
    </div>
  );
}
