<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# PolySpeak - Structural Speaking Coach

A language learning app that helps you practice speaking with structured guidance and AI-powered feedback.

## Features

- 🎯 **Structured Speaking Plans**: Generate visual organizers (Venn diagrams, timelines, etc.) for any topic
- 🎤 **Voice Practice**: Record and analyze your speech with real-time feedback
- 🤖 **AI-Powered Analysis**: Get grammar corrections and natural phrasing suggestions
- 📚 **Expression Library**: Learn idioms, slang, and common phrases
- 💾 **Save & Review**: Bookmark favorite expressions and feedback for later review
- 🔄 **Flashcard System**: Spaced repetition learning for saved content

## New: Local Whisper Integration

This app now uses **local Whisper models** for speech-to-text transcription, providing:
- ✅ **100% Local Processing**: No audio data sent to external services
- ✅ **Privacy-First**: Your voice recordings stay on your device
- ✅ **Works with Any LLM**: Use Whisper + Ollama for completely local operation
- ✅ **Multiple Model Sizes**: Choose from tiny (75MB) to large-v3 (3GB) based on your needs

## Quick Start

### Option 1: Using Startup Scripts (Recommended)

**Windows:**
```bash
start.bat
```

**Mac/Linux:**
```bash
chmod +x start.sh
./start.sh
```

The startup scripts will:
- Check for Node.js installation
- Install dependencies automatically
- Create `.env.local` if needed
- Start the development server

### Option 2: Manual Setup

**Prerequisites:** Node.js (v16 or higher)

1. Install dependencies:
   ```bash
   npm install
   ```

2. (Optional) Set API keys in `.env.local`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
   Note: API keys are optional - you can use local LLMs (Ollama) and Whisper for completely local operation.

3. Run the app:
   ```bash
   npm run dev
   ```

4. Open your browser to `http://localhost:3000`

## Configuration

### Whisper Settings

Access settings by clicking the ⚙️ icon in the top-right corner:

- **Enable Whisper**: Toggle local speech recognition
- **Model Size**: Choose from:
  - `tiny` (~75 MB) - Fastest, lower accuracy
  - `base` (~150 MB) - Good balance
  - `small` (~500 MB) - Better accuracy
  - `medium` (~1.5 GB) - High accuracy
  - `large-v3` (~3 GB) - Best accuracy
- **Language**: Set specific language code (e.g., `en`, `es`, `zh`) or leave empty for auto-detect

**Note:** The first time you use Whisper, the selected model will be downloaded automatically (one-time download).

### LLM Provider Settings

You can choose from multiple AI providers:
- **Google Gemini** (default) - Requires API key (optional for some features)
- **OpenAI** - Requires API key
- **DeepSeek** - Requires API key
- **SiliconFlow** - Requires API key
- **Ollama (Local)** - No API key needed, runs locally

**For completely local operation:**
1. Install [Ollama](https://ollama.ai/)
2. Pull a model: `ollama pull llama3`
3. Select "Ollama (Local)" in settings
4. Enable Whisper in settings
5. Enjoy 100% local, private language learning!

## How It Works

1. **Generate a Plan**: Enter a topic and get a structured speaking plan with visual organizers
2. **Learn Expressions**: Review useful phrases, idioms, and slang related to your topic
3. **Practice Speaking**: Record yourself speaking about the topic
4. **Get Feedback**: Receive transcription, improved text, and specific error corrections
5. **Save & Review**: Bookmark useful content for later study

## Technical Details

- **Frontend**: React + TypeScript + Vite
- **Speech Recognition**: Whisper (via @xenova/transformers)
- **AI Analysis**: Configurable LLM providers (Gemini, OpenAI, Ollama, etc.)
- **Text-to-Speech**: Web Speech API with automatic fallback to Edge TTS
- **Storage**: LocalStorage for saved items and settings
- **Audio Format**: WebM (Opus codec) → Converted to WAV for Whisper

### Text-to-Speech (TTS) Support

The app uses a smart TTS system with multiple fallback layers:

1. **Primary**: Web Speech API (browser's built-in TTS)
   - Works in most modern browsers
   - May require VPN in some regions (e.g., mainland China)

2. **First Fallback**: Edge TTS (Microsoft Edge Text-to-Speech API)
   - **Works in ANY browser** (Chrome, Firefox, Safari, Edge, etc.) - no need to use Edge browser!
   - Automatically used when Web Speech API is unavailable
   - Better compatibility in mainland China
   - Supports multiple languages and voices
   - **Note**: May have CORS restrictions in some network environments

3. **Second Fallback**: Google Translate TTS
   - Automatically used when Edge TTS fails (e.g., due to CORS)
   - Works without CORS issues by using Audio element directly
   - Supports multiple languages
   - Good compatibility in most regions

**Important**: 
- Edge TTS is a web API service, not tied to Edge browser. You can use it in Chrome, Firefox, Safari, or any modern browser.
- The app automatically tries each TTS service in order until one works.
- If all TTS services fail, you'll see a helpful error message with suggestions.

## Troubleshooting

### Whisper Model Download Issues
- Ensure you have a stable internet connection for the first-time model download
- Models are cached in browser storage after first download
- Try a smaller model if download fails

### Audio Recording Issues
- Grant microphone permissions when prompted
- Use Chrome or Edge for best compatibility
- Check browser console for detailed error messages

### LLM Connection Issues
- For Ollama: Ensure Ollama is running (`ollama serve`)
- For API providers: Check your API key and network connection
- Review browser console for specific error messages

### Text-to-Speech Issues
- **In Mainland China**: The app automatically falls back through multiple TTS services (Edge TTS → Google TTS)
- **Browser Compatibility**: All TTS services work in any modern browser (Chrome, Firefox, Safari, Edge) - you don't need to use Edge browser
- **CORS Errors**: If you see "Failed to fetch" errors, the app will automatically try Google TTS as a fallback
- If TTS doesn't work: Check browser console for error messages
- Some browsers may require user interaction before playing audio (click to enable)
- If all TTS services fail, you may need to:
  1. Use VPN to access TTS services
  2. Configure a proxy server
  3. Check your network firewall settings

## License

This project is open source and available for personal and educational use.
