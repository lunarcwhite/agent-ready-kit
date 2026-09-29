// Session gate (TASK-010). Auth.js reads the JWT from the cookie and
// attaches req.auth — no database hit on the middleware path. Public
// surface: landing, login, and the Auth.js handlers themselves
// (/api/auth/*). Everything else redirects to /login, preserving no
// return-URL (YAGNI: TASK-012's project list is the only protected page).
import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/api/auth")
  )
    return;
  if (!req.auth?.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return Response.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
