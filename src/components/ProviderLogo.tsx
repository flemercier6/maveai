import type { Provider } from "@/lib/models";
import claudeLogo from "@/assets/claude-logo.png";
import geminiLogo from "@/assets/gemini-logo.png";
import openaiLogo from "@/assets/openai-logo.png";

function OpenAILogo({ className }: { className?: string }) {
  return (
    <img src={openaiLogo} alt="OpenAI" className={`${className ?? ""} object-contain rounded-[3px] dark:invert`} />
  );
}

function AnthropicLogo({ className }: { className?: string }) {
  return (
    <img src={claudeLogo} alt="Claude" className={`${className ?? ""} object-contain rounded-[3px]`} />
  );
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <img src={geminiLogo} alt="Gemini" className={`${className ?? ""} object-contain rounded-[3px]`} />
  );
}

const LOGOS: Record<Provider, React.ComponentType<{ className?: string }>> = {
  openai: OpenAILogo,
  anthropic: AnthropicLogo,
  google: GoogleLogo,
};

export function ProviderLogo({ provider, className }: { provider: Provider; className?: string }) {
  const Logo = LOGOS[provider];
  return <Logo className={className} />;
}
