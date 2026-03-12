"""
Test script to check which Gemini models are available with your API key
"""
from google import genai
import os
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

print("Testing API key and listing available models...\n")

try:
    # List all available models
    models = client.models.list()
    
    print("✅ API Key is valid!\n")
    print("Available models:")
    print("-" * 60)
    
    computer_use_models = []
    other_models = []
    
    for model in models:
        model_name = model.name
        if "computer" in model_name.lower() or "2.5" in model_name or "3.0" in model_name:
            computer_use_models.append(model_name)
        else:
            other_models.append(model_name)
    
    if computer_use_models:
        print("\n🎯 Computer Use / Preview Models:")
        for m in computer_use_models:
            print(f"  - {m}")
    
    if other_models:
        print("\n📋 Other Available Models:")
        for m in other_models[:10]:  # Show first 10
            print(f"  - {m}")
        if len(other_models) > 10:
            print(f"  ... and {len(other_models) - 10} more")
    
    print("\n" + "=" * 60)
    print("Recommended model to use:")
    if computer_use_models:
        print(f"✅ {computer_use_models[0]}")
    else:
        print("⚠️  No Computer Use models found with this API key")
        print("Try: gemini-2.0-flash-exp or gemini-1.5-flash")
    
except Exception as e:
    print(f"❌ Error: {e}")
    print("\nPossible issues:")
    print("1. API key is invalid")
    print("2. Generative Language API not enabled in Google Cloud Console")
    print("3. API key doesn't have proper permissions")
