FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    openssh-client \
    jq \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Install kubectl
RUN curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/kubernetes-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/kubernetes-archive-keyring.gpg] https://apt.kubernetes.io/ kubernetes-xenial main" | tee /etc/apt/sources.list.d/kubernetes.list \
    && apt-get update \
    && apt-get install -y kubectl \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV DOMAIN_NAME=
ENV KUBECONFIG=/config/kubeconfig.yml

# Create directories
RUN mkdir -p /config

# Set working directory
WORKDIR /config

# Volume for configuration files
VOLUME /config

# Default command
CMD ["bash"]
