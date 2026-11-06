# mgu-inputgate: the controller gate, loaded into the HMI (README.md).
#   make target     build/target/mgu-inputgate.so, in the head unit's userland (docker/target)
#   make test       the install kit against the updater's (kit/, test/kit_test.js)
DOCKER ?= docker
TARGET_IMAGE = mgu-inputgate-target
RUN = $(DOCKER) run --rm --user "$$(id -u):$$(id -g)" -v "$(CURDIR):/w" -w /w

.PHONY: target test in-build
target:
	$(DOCKER) build -q --platform linux/amd64 -t $(TARGET_IMAGE) docker/target >/dev/null
	$(RUN) --platform linux/amd64 $(TARGET_IMAGE) make -s in-build

in-build: build/target/mgu-inputgate.so

build/target/mgu-inputgate.so: src/mgu-inputgate.cpp
	@mkdir -p build/target
	$(CXX) -std=c++14 -O2 -g0 -Wall -shared -fPIC -Ivsomeip-include/interface/compat -o $@ $< -ldl

test:
	node test/kit_test.js
