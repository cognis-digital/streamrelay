# streamrelay — build / test / demo / install helpers.
# ffmpeg is the only external RUNTIME requirement; nothing here needs it.

.PHONY: all build typecheck test demo lint clean install uninstall

all: build

build:
	npm install
	npm run build

typecheck:
	npx tsc --noEmit

test: build
	npm test

demo: build
	sh demos/run_all.sh

# There is no third-party linter (zero deps by design). tsc's strict mode +
# noUnusedLocals/noUnusedParameters is the lint gate.
lint: typecheck
	@echo "lint: tsc --noEmit strict is the lint gate (no external linter by design)"

clean:
	rm -rf dist node_modules

install: build
	npm link
	@echo "installed: 'streamrelay' is now on your PATH (npm link)."

uninstall:
	npm unlink -g @cognis-digital/streamrelay || true
