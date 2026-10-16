import { useEffect } from "react";
import type { ReactNode } from "react";
import cheyaLogo from "../assets/circle.png";

type LegalPageKind = "privacy" | "terms";

const contactEmail = "neverlabs4@gmail.com";

export function LegalPage({ kind }: { kind: LegalPageKind }) {
  const isPrivacy = kind === "privacy";
  const title = isPrivacy ? "Kebijakan Privasi" : "Ketentuan Layanan";

  useEffect(() => {
    document.title = `${title} | CheyaVerse`;
  }, [title]);

  return (
    <main className="h-full overflow-y-auto bg-[#f5f6f8] px-4 py-8 text-[#27282d] sm:px-6 sm:py-12">
      <article className="mx-auto max-w-3xl overflow-hidden rounded-[28px] border border-[#e7e8eb] bg-white shadow-[0_8px_32px_rgba(25,32,43,0.06)]">
        <header className="border-b border-[#eceef0] px-6 py-6 sm:px-10 sm:py-8">
          <a href="/" className="inline-flex items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#229fe3]">
            <img
              src={cheyaLogo}
              alt=""
              className="size-11 rounded-full border border-[#e7e8eb] object-cover"
              draggable={false}
            />
            <span className="text-sm font-semibold tracking-tight text-[#25262a]">CheyaVerse</span>
          </a>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-[#202126] sm:text-3xl">
            {title}
          </h1>
          <p className="mt-2 text-sm text-[#777a82]">Berlaku mulai 16 Oktober 2026</p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#5f626a]">
            {isPrivacy
              ? "Halaman ini menjelaskan informasi yang diproses saat Anda menggunakan CheyaVerse, bagaimana informasi tersebut digunakan, dan pilihan yang tersedia bagi Anda."
              : "Ketentuan ini mengatur penggunaan CheyaVerse. Dengan menggunakan layanan, Anda menyetujui ketentuan berikut."}
          </p>
        </header>

        {isPrivacy ? <PrivacyPolicy /> : <TermsOfService />}

        <footer className="flex flex-col gap-3 border-t border-[#eceef0] px-6 py-5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <a href="/" className="font-medium text-[#356d91] hover:underline">
            Kembali ke CheyaVerse
          </a>
          <nav aria-label="Legal information" className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a href="/privacy" className="text-[#5f626a] hover:text-[#25262a] hover:underline">
              Privasi
            </a>
            <a href="/terms" className="text-[#5f626a] hover:text-[#25262a] hover:underline">
              Ketentuan
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
    <section className="border-b border-[#f0f1f3] px-6 py-6 last:border-b-0 sm:px-10">
      <h2 className="text-base font-semibold text-[#25262a]">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-[#5f626a]">{children}</div>
    </section>
  );
}

function PrivacyPolicy() {
  return (
    <div>
      <PolicySection title="Informasi yang diproses">
        <p>
          Saat Anda masuk, Google dan Supabase memproses informasi akun yang diperlukan untuk
          autentikasi, seperti identitas akun dan alamat email. CheyaVerse mengaitkan data layanan
          dengan ID akun Supabase Anda.
        </p>
        <p>
          Layanan menyimpan konten yang Anda buat atau kirim, termasuk pesan, balasan AI, versi
          pesan, lampiran, umpan balik, pengaturan personalisasi, insight, dan memori yang dibuat
          dari percakapan. Jika Anda menambahkan kunci API Gemini sendiri, kunci tersebut disimpan
          pada basis data akun agar dapat digunakan untuk menjalankan fitur AI.
        </p>
        <p>
          Browser Anda juga dapat menyimpan sesi masuk dan draf pesan atau lampiran yang belum
          dikirim agar dapat dipulihkan setelah halaman dimuat ulang.
        </p>
      </PolicySection>

      <PolicySection title="Bagaimana informasi digunakan dan dibagikan">
        <p>
          Data digunakan untuk menyediakan chat, menyinkronkan akun dan pengaturan, memproses
          lampiran, menghasilkan balasan dan fitur AI, serta menjaga keamanan dan keandalan
          layanan. Kami tidak menjual data pribadi atau menggunakan percakapan untuk iklan.
        </p>
        <p>
          CheyaVerse menggunakan Supabase untuk autentikasi, basis data, dan penyimpanan file;
          Vercel untuk hosting dan pemrosesan aplikasi; Google untuk masuk dan layanan Gemini AI;
          serta Cloudflare Turnstile untuk pemeriksaan keamanan saat masuk. Saat fitur pencarian
          web digunakan, query atau halaman yang diminta dapat diproses oleh penyedia pencarian
          pihak ketiga yang digunakan layanan.
        </p>
        <p>
          Pesan, konteks percakapan yang relevan, dan lampiran yang Anda pilih dapat dikirim ke
          Google Gemini melalui kunci API Gemini yang Anda konfigurasi agar model dapat menjawab.
          Penggunaan layanan pihak ketiga juga tunduk pada kebijakan mereka masing-masing.
        </p>
      </PolicySection>

      <PolicySection title="Penyimpanan dan penghapusan">
        <p>
          Lampiran disimpan di penyimpanan privat dan tidak lagi tersedia setelah masa berlakunya
          berakhir, paling lama 24 jam setelah diunggah. Alur pembersihan menghapus file beserta
          metadata lampirannya setelah kedaluwarsa; pemrosesan pembersihan dapat mengalami
          keterlambatan teknis.
        </p>
        <p>
          Pesan, versi pesan, insight, memori, pengaturan, dan umpan balik tidak mengikuti batas
          24 jam lampiran. Data tersebut tetap tersimpan sampai Anda menghapusnya melalui fitur
          yang tersedia atau menghubungi kami untuk meminta penghapusan. Menghapus lampiran tidak
          otomatis menghapus pesan atau insight terkait.
        </p>
        <p>
          Untuk pertanyaan atau permintaan terkait data akun, hubungi{" "}
          <a className="font-medium text-[#356d91] hover:underline" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
          . Kami mungkin perlu memverifikasi bahwa permintaan berasal dari pemilik akun.
        </p>
      </PolicySection>

      <PolicySection title="Keamanan dan perubahan">
        <p>
          Kami menerapkan kontrol akses akun dan pembatasan akses pada data untuk melindungi
          informasi. Tidak ada metode penyimpanan atau transmisi elektronik yang dapat dijamin
          sepenuhnya aman.
        </p>
        <p>
          Kebijakan ini dapat diperbarui ketika layanan atau kewajiban yang berlaku berubah.
          Versi terbaru akan dipublikasikan di halaman ini beserta tanggal berlakunya.
        </p>
      </PolicySection>
    </div>
  );
}

function TermsOfService() {
  return (
    <div>
      <PolicySection title="Menggunakan layanan">
        <p>
          CheyaVerse menyediakan ruang percakapan AI, penyimpanan riwayat chat, pengelolaan
          personalisasi, serta fitur lampiran dan pencarian web. Anda bertanggung jawab menjaga
          akses ke akun dan kunci API yang Anda tambahkan.
        </p>
        <p>
          Anda hanya boleh mengirim konten yang berhak Anda gunakan. Jangan menggunakan layanan
          untuk melanggar hukum, mengganggu keamanan atau ketersediaan layanan, atau melanggar hak
          orang lain.
        </p>
      </PolicySection>

      <PolicySection title="Fitur AI dan layanan pihak ketiga">
        <p>
          Jawaban AI dapat keliru, tidak lengkap, atau tidak sesuai konteks. Jangan mengandalkan
          jawaban sebagai nasihat profesional, medis, hukum, atau keuangan tanpa memeriksanya
          kepada tenaga ahli yang sesuai.
        </p>
        <p>
          Fitur AI menggunakan kunci API Gemini yang Anda sediakan. Anda bertanggung jawab atas
          penggunaan dan ketentuan akun penyedia API tersebut. Fitur masuk, hosting, penyimpanan,
          pemeriksaan keamanan, dan pencarian web juga bergantung pada layanan pihak ketiga dan
          dapat tunduk pada ketentuan mereka.
        </p>
      </PolicySection>

      <PolicySection title="Konten dan lampiran">
        <p>
          Anda tetap memiliki hak atas konten yang Anda kirim. Anda memberi izin terbatas kepada
          CheyaVerse untuk menyimpan dan memproses konten tersebut hanya sejauh diperlukan untuk
          menjalankan fitur yang Anda gunakan.
        </p>
        <p>
          File dan media yang dilampirkan hanya tersedia selama masa retensinya, paling lama 24
          jam setelah diunggah, lalu dijadwalkan untuk dihapus. Pesan dan data percakapan terkait
          dapat tetap tersimpan sampai dihapus secara terpisah.
        </p>
      </PolicySection>

      <PolicySection title="Ketersediaan, perubahan, dan kontak">
        <p>
          Kami berupaya menjaga layanan tetap tersedia, tetapi tidak menjamin layanan selalu tanpa
          gangguan atau bebas kesalahan. Fitur dapat diperbaiki, diubah, atau dihentikan.
        </p>
        <p>
          Ketentuan ini dapat diperbarui dengan menerbitkan versi terbaru di halaman ini. Untuk
          pertanyaan tentang ketentuan atau permintaan terkait akun, hubungi{" "}
          <a className="font-medium text-[#356d91] hover:underline" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
          .
        </p>
        <p>
          Ketentuan ini tidak mengurangi hak konsumen yang tidak dapat dikesampingkan berdasarkan
          hukum yang berlaku.
        </p>
      </PolicySection>
    </div>
  );
}
