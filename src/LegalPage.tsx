import { useEffect } from "react";
import type { ReactNode } from "react";

type LegalPageKind = "privacy" | "terms";

const contactEmail = "neverlabs4@gmail.com";

export function LegalPage({ kind }: { kind: LegalPageKind }) {
  const isPrivacy = kind === "privacy";
  const title = isPrivacy ? "Privacy Policy" : "Terms of Service";

  useEffect(() => {
    document.title = `${title} | CheyaAPP`;
  }, [title]);

  return (
    <main className="fixed inset-0 overflow-y-auto overscroll-contain bg-white px-5 py-8 text-[#27282d] sm:px-8 sm:py-12">
      <article className="mx-auto max-w-5xl">
        <header className="border-b border-[#e7e8eb] px-1 pb-8 sm:pb-10">
          <h1 className="text-2xl font-semibold tracking-tight text-[#202126] sm:text-3xl">
            {title}
          </h1>
          <p className="mt-2 text-sm text-[#777a82]">Effective October 16, 2026</p>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[#5f626a] sm:text-base sm:leading-8">
            {isPrivacy
              ? "This policy explains what information is processed when you use CheyaAPP, how it is used, and the choices available to you."
              : "These terms govern your use of CheyaAPP. By using the service, you agree to the following terms."}
          </p>
        </header>

        {isPrivacy ? <PrivacyPolicy /> : <TermsOfService />}

        <footer className="mt-2 flex flex-col gap-3 border-t border-[#e7e8eb] px-1 py-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <a href="/" className="font-medium text-[#356d91] hover:underline">
            Back to home
          </a>
          <nav aria-label="Legal information" className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a href="/privacy" className="text-[#5f626a] hover:text-[#25262a] hover:underline">
              Privacy
            </a>
            <a href="/terms" className="text-[#5f626a] hover:text-[#25262a] hover:underline">
              Terms
            </a>
            <a href={`mailto:${contactEmail}`} className="text-[#5f626a] hover:text-[#25262a]">
              {contactEmail}
            </a>
          </nav>
        </footer>
      </article>
    </main>
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
          When you sign in, Google and Supabase process the account information needed to
          authenticate you, such as your account identity and email address. CheyaAPP associates
          service data with your Supabase account ID.
        </p>
        <p>
          Google Sign-In is used for authentication. CheyaAPP does not request access to Gmail,
          Google Drive, contacts, or other Google content.
        </p>
        <p>
          The service stores content you create or send, including messages, AI replies, message
          versions, attachments, feedback, personalization settings, insights, and memories created
          from conversations. If you add your own Gemini API key, it is stored with your account so
          AI features can use it.
        </p>
        <p>
          Your browser may also store your sign-in session and unsent message or attachment drafts
          so they can be restored after a page reload.
        </p>
      </PolicySection>

      <PolicySection title="How information is used and shared">
        <p>
          Data is used to provide chat, sync your account and settings, process attachments,
          generate AI replies and features, and maintain service security and reliability. We do
          not sell personal data or use conversations for advertising.
        </p>
        <p>
          CheyaAPP uses Supabase for authentication, database, and file storage; Vercel for
          application hosting and processing; Google for sign-in and Gemini AI; and Cloudflare
          Turnstile for sign-in security checks. When web search is used, queries or requested pages
          may be processed by the third-party search providers used by the service.
        </p>
        <p>
          Messages, relevant conversation context, and attachments you select may be sent to Google
          Gemini using the Gemini API key you configured so the model can respond. Your use of
          third-party services is also subject to their respective policies.
        </p>
      </PolicySection>

      <PolicySection title="Retention and deletion">
        <p>
          Attachments are stored privately and are no longer available after their retention period,
          at most 24 hours after upload. The cleanup process removes expired files and their
          attachment metadata; technical delays may affect when cleanup completes.
        </p>
        <p>
          Messages, versions, insights, memories, settings, and feedback are not covered by the
          24-hour attachment retention period. They remain stored until you delete them using
          available features or contact us to request deletion. Deleting an attachment does not
          automatically delete related messages or insights.
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
          We use account access controls and data access restrictions to help protect information.
          No electronic storage or transmission method can be guaranteed completely secure.
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
          CheyaAPP provides an AI conversation workspace, chat history, personalization
          management, attachments, and web search. You are responsible for protecting access to
          your account and any API keys you add.
        </p>
        <p>
          You may only submit content you have the right to use. Do not use the service to violate
          the law, compromise the security or availability of the service, or infringe on another
          person&apos;s rights.
        </p>
      </PolicySection>

      <PolicySection title="AI features and third-party services">
        <p>
          AI responses may be incorrect, incomplete, or out of context. Do not rely on them as
          professional, medical, legal, or financial advice without consulting an appropriate
          qualified professional.
        </p>
        <p>
          AI features use the Gemini API key you provide. You are responsible for your use of, and
          compliance with, your API provider&apos;s account terms. Sign-in, hosting, storage,
          security checks, and web search also depend on third-party services and may be subject to
          their terms.
        </p>
      </PolicySection>

      <PolicySection title="Content and attachments">
        <p>
          You retain your rights to content you submit. You grant CheyaAPP limited permission to
          store and process that content only as needed to provide the features you use.
        </p>
        <p>
          Attached files and media are available only for their retention period, at most 24 hours
          after upload, and are then scheduled for deletion. Related messages and conversation data
          may remain stored until deleted separately.
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
