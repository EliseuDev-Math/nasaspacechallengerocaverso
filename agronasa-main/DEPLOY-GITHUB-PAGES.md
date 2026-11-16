# Publicar o AgroNASA no GitHub Pages

O projeto original (`agro-backend/`) **não foi alterado**. Foi adicionada a pasta `docs/`, uma versão
estática do mesmo site: em vez de chamar o servidor FastAPI, o navegador consulta a NASA POWER diretamente
(`docs/engine.js` é uma porta fiel de `crops.py`, `scoring.py` e `nasa.py`). Visual e textos são os mesmos.

## Passo a passo
1. Envie todo o conteúdo desta pasta para um repositório no GitHub (branch `main`).
2. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Faça um push (ou rode **Actions → Deploy to GitHub Pages → Run workflow**).
4. O endereço aparece no fim do job: `https://SEU-USUARIO.github.io/NOME-DO-REPO/`

Alternativa sem Actions: **Source: Deploy from a branch → `main` → `/docs`**.

## Observações
- Geolocalização automática funciona porque o GitHub Pages usa HTTPS.
- A primeira consulta de cada local pode levar até ~30 s (a NASA envia ~8 anos de dados diários);
  o resultado fica em cache no navegador por 12 h.
- Não há chaves, servidor nem variáveis de ambiente. Rate limit/API key do backend não se aplicam aqui.
- Para testar localmente: `cd docs && python -m http.server 8080` e abra http://localhost:8080
