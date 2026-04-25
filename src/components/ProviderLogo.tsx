import type { Provider } from "@/lib/models";
import claudeLogo from "@/assets/claude-logo.png";
import geminiLogo from "@/assets/gemini-logo.png";
import openaiLogo from "@/assets/openai-logo.png";
import mistralLogo from "@/assets/mistral-logo.jpg";

function OpenAILogo({ className }: { className?: string }) {
  return (
    <img src={openaiLogo} alt="OpenAI" className={`${className ?? ""} object-contain rounded-[4px] block dark:invert`} />
  );
}

function AnthropicLogo({ className }: { className?: string }) {
  return (
    <img src={claudeLogo} alt="Claude" className={`${className ?? ""} object-contain rounded-[4px] block`} />
  );
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <img src={geminiLogo} alt="Gemini" className={`${className ?? ""} object-contain rounded-[4px] block`} />
  );
}

function MistralLogo({ className }: { className?: string }) {
  return (
    <img src={mistralLogo} alt="Mistral" className={`${className ?? ""} object-contain rounded-[4px] block`} />
  );
}

const LOGOS: Record<Provider, React.ComponentType<{ className?: string }>> = {
  openai: OpenAILogo,
  anthropic: AnthropicLogo,
  google: GoogleLogo,
  mistral: MistralLogo,
};

export function ProviderLogo({ provider, className }: { provider: Provider; className?: string }) {
  const Logo = LOGOS[provider];
  return <Logo className={className} />;
}
