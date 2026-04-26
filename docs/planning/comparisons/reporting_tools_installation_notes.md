# Reporting Tools Installation Notes

This document captures the installation and setup steps for the three reporting tools located in `~/Projects/ReportingTools`: **Allure 2**, **ReportPortal**, and **Sorry Cypress**.

> [!WARNING]
> The current macOS environment is a virtual machine running on Apple Silicon hardware that **does not support nested virtualization**. As a result, Docker engine runtimes like Colima (and Docker Desktop) cannot start the internal Linux VM required to run containers (`VZErrorDomain Code=2: Virtualization is not available on this hardware`). Because ReportPortal and Sorry Cypress rely entirely on Docker, they cannot be actively run on this specific VM. The notes below detail the steps for an environment that *does* support Docker.

## 1. Prerequisites (macOS)

For a fresh macOS machine, you will need Java (for Allure) and Docker (for the others).

```bash
# Install Homebrew dependencies
brew install openjdk allure docker docker-compose colima
```

### Configure Java
To make OpenJDK accessible via your PATH (add this to your `~/.zshrc`):
```bash
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
sudo ln -sfn /opt/homebrew/opt/openjdk/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk.jdk
```

### Configure Docker
To enable the `docker-compose` plugin:
```bash
mkdir -p ~/.docker
echo '{"cliPluginsExtraDirs":["/opt/homebrew/lib/docker/cli-plugins"]}' > ~/.docker/config.json
```

Start the Docker daemon (on hardware that supports virtualization):
```bash
colima start
```

---

## 2. Allure 2 Setup

Allure is a standalone Java application. Installing it via Homebrew (`brew install allure`) is the easiest and most robust method.

**Location:** `~/Projects/ReportingTools/allure2`

**To use:**
- Generate a report from test results: `allure generate path/to/results`
- Serve a report and open it in the browser: `allure serve path/to/results`

*Note: Since the source code is present in the `allure2` folder, you could also build it using `./gradlew build` if you needed to test local modifications to Allure itself.*

---

## 3. ReportPortal Setup

ReportPortal uses a microservices architecture managed via Docker Compose.

**Location:** `~/Projects/ReportingTools/report-portal/reportportal`

**Setup Steps:**
1. Navigate to the directory: `cd ~/Projects/ReportingTools/report-portal/reportportal`
2. Create the environment file: `cp .template.env .env`
3. Launch the stack in the background: `docker-compose up -d`
4. The main application will typically be accessible on `http://localhost:8080`.

> [!CAUTION]
> ReportPortal requires significant resources (RAM/CPU) as it spins up PostgreSQL, RabbitMQ, Elasticsearch/OpenSearch, and multiple Spring Boot Java microservices. Ensure Colima or Docker Desktop is configured with at least 4-8GB of RAM and multiple CPU cores.

---

## 4. Sorry Cypress Setup

Sorry Cypress is a lighter-weight Docker deployment but still requires a database (MongoDB) and director/API services.

**Location:** `~/Projects/ReportingTools/sorry-cypress`

**Setup Steps:**
1. Navigate to the directory: `cd ~/Projects/ReportingTools/sorry-cypress`
2. Launch the full stack: `docker-compose -f docker-compose.full.yml up -d`
3. The dashboard is typically exposed on `http://localhost:8080`.

> [!TIP]
> **Port Conflict Handling:** Both ReportPortal and Sorry Cypress map to `8080` by default. If you need to run them simultaneously, you must modify the `ports` mapping in one of the `docker-compose.yml` files (e.g., mapping Sorry Cypress to `8081:8080`).
