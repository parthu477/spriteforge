# ==============================================================
# SpriteForge — services/providers/base.py
# ImageProvider protocol + exceptions (US-08, US-09, ADR-05)
# ==============================================================
from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    import PIL.Image


# ── Custom exceptions ─────────────────────────────────────────

class ProviderError(Exception):
    """Base for all provider errors."""
    code: str = "provider_error"


class ProviderAuthError(ProviderError):
    """401/403 — credentials invalid (AC 8.3)."""
    code = "provider_auth"


class ProviderRateLimited(ProviderError):
    """429 after all retries exhausted."""
    code = "provider_rate_limited"


class ProviderQuotaExceeded(ProviderError):
    """Daily free-tier allowance used up."""
    code = "provider_quota_exceeded"


class ProviderUnavailable(ProviderError):
    """5xx / timeout after all retries."""
    code = "provider_unavailable"


class ProviderBadResponse(ProviderError):
    """Response is not an image, wrong content-type, or > size limit (AC 8.5)."""
    code = "provider_bad_response"


class ProviderLocalError(ProviderError):
    """Local CPU model failed to load or ran out of memory."""
    code = "provider_local_error"


# ── Protocol ─────────────────────────────────────────────────

@runtime_checkable
class ImageProvider(Protocol):
    name: str
    model: str
    max_side: int
    supports_negative_prompt: bool
    supports_seed: bool

    def generate(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        seed: int,
    ) -> "PIL.Image.Image":
        ...


# ── Factory ───────────────────────────────────────────────────

def get_provider(name: str) -> ImageProvider:
    """Build the provider specified by *name* from config."""
    name = name.strip().lower()
    if name == "cloudflare":
        from .cloudflare import CloudflareProvider
        return CloudflareProvider()
    elif name == "local_cpu":
        from .local_cpu import LocalCpuProvider
        return LocalCpuProvider()
    elif name == "huggingface":
        from .huggingface import HuggingFaceProvider
        return HuggingFaceProvider()
    elif name == "mock":
        from .mock import MockProvider
        return MockProvider()
    else:
        raise ValueError(f"Unknown provider: {name!r}")
