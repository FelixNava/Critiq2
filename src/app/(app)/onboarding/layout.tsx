import Link from "next/link";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-xl">
        <Link
          href="/"
          className="mb-8 block text-center text-xl font-semibold tracking-tight text-slate-900"
        >
          Critiq
        </Link>
        {children}
      </div>
    </div>
  );
}
