# Running the Binder Book's AI on your own computer (Ollama)

The Binder Book and AMS use AI to read documents (dec pages, policy PDFs,
photos of licenses) and to answer questions. By default this goes to Claude
in the cloud. With Ollama, the same features run on a computer in your
office, so client documents never leave it.

## 1. Install Ollama and the models (one time)

1. Download Ollama from https://ollama.com and install it (Windows or Mac).
2. Open a terminal (Windows: PowerShell; Mac: Terminal) and run:

```
ollama pull llama3.1:8b
ollama pull llama3.2-vision
```

`llama3.1:8b` handles text and text-based PDFs. `llama3.2-vision` handles
photos and scanned PDFs. A computer with 16 GB of memory runs both; a
graphics card makes them much faster. Stronger options if the computer can
take them: `qwen2.5:14b` (text) and `qwen2.5vl:7b` (vision).

## 2. Let the Binder Book talk to Ollama

Ollama only answers web pages it is told to trust. Set this once, then
restart Ollama.

Windows, in PowerShell:

```
setx OLLAMA_ORIGINS "https://uib-binderbook.vercel.app"
```

Then quit Ollama from the system tray and start it again.

Mac, in Terminal:

```
launchctl setenv OLLAMA_ORIGINS "https://uib-binderbook.vercel.app"
```

Then quit Ollama from the menu bar and start it again.

The first time the Binder Book contacts Ollama, Chrome may ask to allow
access to devices on your local network. Choose **Allow**.

## 3. Switch the engine

1. Sign in as an administrator, open the Admin console, press **AI Engine**.
2. Engine: **Ollama (local)**. Address: `http://localhost:11434`.
3. Press **Test connection**. It lists the installed models.
4. Pick the text and vision models.
5. Keep **If Ollama can't be reached, use Claude instead** ticked so
   phones and other computers keep working.
6. Apply to:
   - **This device only**: just the computer running Ollama uses it.
     Recommended; everyone else keeps Claude.
   - **Whole agency**: every device tries Ollama first; devices that
     can't reach it fall back to Claude (or fail, if fallback is off).

## What to know

- Ollama runs on one computer. Phones and other computers reach
  `localhost` on themselves, not on the Ollama computer, so they use the
  fallback. Serving other devices from one Ollama machine needs that
  machine on HTTPS (for example a Cloudflare Tunnel) and its address added
  to the Content-Security-Policy in `vercel.json`.
- Local models are less accurate than Claude at reading dense dec pages.
  Check extracted fields before saving, especially at first.
- PDFs: text is read from the PDF itself; scanned PDFs (no text layer)
  send their first 6 pages as images to the vision model.
- The Access Log records each AI request with the engine used, and every
  change to the AI Engine setting.
- To switch back, use the same screen: Engine, Claude (cloud).
