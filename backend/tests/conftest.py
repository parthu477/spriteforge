import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

# Set minimal env so config.py doesn't fail at import
os.environ.setdefault("PROVIDER", "cloudflare")
os.environ.setdefault("FALLBACK_PROVIDER", "local_cpu")
os.environ.setdefault("CF_ACCOUNT_ID", "test_account")
os.environ.setdefault("CF_API_TOKEN", "test_token")
os.environ.setdefault("FLASK_HOST", "127.0.0.1")
os.environ.setdefault("FLASK_DEBUG", "false")
os.environ.setdefault("ASSET_DIR", os.path.join(tempfile.gettempdir(), "spriteforge_test_assets"))
