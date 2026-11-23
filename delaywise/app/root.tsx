import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** M1: a calm fallback instead of the framework's default error screen. */
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  console.error("[app] unhandled error", error);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Delaywise</title>
        <Meta />
        <Links />
      </head>
      <body style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 24, color: "#303030" }}>
        <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
        <p>
          {status === 404
            ? "This page doesn't exist."
            : "Delaywise couldn't load this page. Please refresh in a moment. If it keeps happening, contact support."}
        </p>
        <Scripts />
      </body>
    </html>
  );
}
