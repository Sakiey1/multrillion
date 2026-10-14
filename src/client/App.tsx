import { useEffect, useState } from "react";
import { Home } from "./screens/Home";
import { RoomPage } from "./screens/RoomPage";

function parseRoute(): { code: string | null } {
  const m = /^\/r\/([A-Za-z]{4})\/?$/.exec(location.pathname);
  return { code: m ? m[1].toUpperCase() : null };
}

export function navigate(path: string, state?: unknown) {
  history.pushState(state ?? null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function App() {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (route.code) {
    const autoName = (history.state as { name?: string } | null)?.name ?? null;
    return <RoomPage key={route.code} code={route.code} autoName={autoName} />;
  }
  return <Home />;
}
