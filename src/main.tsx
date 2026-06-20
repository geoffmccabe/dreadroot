import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { captureDivigoTokenOnBoot } from "./features/wallet/divigoConnect";

// If the SSO bounced us back from the DiviGo consent screen, store the token + clean the URL (no-op otherwise).
void captureDivigoTokenOnBoot();

createRoot(document.getElementById("root")!).render(<App />);
