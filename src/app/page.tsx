import { redirect } from "next/navigation";

export default function Home() {
  // Middleware bounces unauthenticated users to /login; the (app) layout
  // authorizes against the Kiara tenant.
  redirect("/inbox");
}
