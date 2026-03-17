.PHONY: dev-backend dev-frontend dev build up down logs test

# Development
dev-backend:
	cd backend && uv run uvicorn sqlforge.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd frontend && npm run dev

dev:
	@echo "Run in two terminals:"
	@echo "  make dev-backend"
	@echo "  make dev-frontend"

# Docker
build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=50

# Tests
test:
	cd backend && uv run python -m pytest tests/ -v
