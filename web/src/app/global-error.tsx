"use client";

// Next.js replaces the root layout entirely when rendering this boundary, so
// it must render its own <html>/<body> and can't rely on anything from
// layout.tsx (fonts, providers, AppShell). Without an explicit file here,
// Next synthesizes a default one -- under Turbopack production builds that
// default collides with the real root layout's <html>/<head> during the
// static prerender of "/_global-error" (TypeError: Cannot read properties of
// null (reading 'useContext')). Defining it ourselves, kept intentionally
// bare, avoids that.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h2>Something went wrong</h2>
        <p style={{ opacity: 0.7 }}>{error.message || "An unexpected error occurred."}</p>
        <button onClick={() => reset()} style={{ marginTop: "1rem" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
