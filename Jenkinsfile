// Deploys only the `dev` branch to the VPS, as the `development` environment.
// `main` is production and stays on Netlify (see netlify.toml) — every stage
// below is gated with `when { branch 'dev' }` so a push to any other branch
// (including `main`) shows as skipped, not failed.
//
// No VPS detail is hardcoded here: DEPLOY_USER, DEPLOY_DIR, DEPLOY_HOST and
// DOCKER_SUBNET all come from the Jenkins credential file
// `donde-ayudar-env-development`. The deploy target does not have to be the
// same machine Jenkins runs on — every stage after Load Config only talks to
// it over SSH, so nothing here assumes local/bridge networking.
pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '5'))
        timestamps()
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        PROJECT_NAME = 'donde-ayudar'
        APP_ENV      = 'development'
        SSH_OPTS     = '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR'
    }

    stages {

        stage('Load Config') {
            when { branch 'dev' }
            steps {
                withCredentials([file(credentialsId: "${PROJECT_NAME}-env-${env.APP_ENV}", variable: 'ENV_FILE')]) {
                    script {
                        withEnv(["SECRET_PATH=${ENV_FILE}"]) {
                            env.DEPLOY_USER = sh(
                                script: 'grep "^DEPLOY_USER=" "$SECRET_PATH" | cut -d= -f2- | tr -d \'"\'',
                                returnStdout: true
                            ).trim()
                            env.DEPLOY_DIR = sh(
                                script: 'grep "^DEPLOY_DIR=" "$SECRET_PATH" | cut -d= -f2- | tr -d \'"\'',
                                returnStdout: true
                            ).trim()
                            env.DEPLOY_HOST = sh(
                                script: 'grep "^DEPLOY_HOST=" "$SECRET_PATH" | cut -d= -f2- | tr -d \'"\'',
                                returnStdout: true
                            ).trim()
                        }

                        if (!env.DEPLOY_USER) {
                            error "Missing DEPLOY_USER in .env secret file"
                        }
                        if (!env.DEPLOY_DIR) {
                            error "Missing DEPLOY_DIR in .env secret file"
                        }
                        if (!env.DEPLOY_HOST) {
                            error "Missing DEPLOY_HOST in .env secret file"
                        }

                        echo "═══════════════════════════════════════"
                        echo "Environment: ${env.APP_ENV}"
                        echo "Deploy User: ${env.DEPLOY_USER}"
                        echo "Deploy Host: ${env.DEPLOY_HOST}"
                        echo "Deploy Dir:  ${env.DEPLOY_DIR}"
                        echo "═══════════════════════════════════════"
                    }
                }
            }
        }

        stage('Validate') {
            when { branch 'dev' }
            steps {
                sh """
                    ssh ${SSH_OPTS} ${DEPLOY_USER}@${DEPLOY_HOST} '
                        echo "Host reachable" &&
                        docker version --format "Docker {{.Server.Version}}" &&
                        docker compose version --short &&
                        git --version
                    '
                """
            }
        }

        stage('Pull') {
            when { branch 'dev' }
            steps {
                sh """
                    ssh ${SSH_OPTS} ${DEPLOY_USER}@${DEPLOY_HOST} '
                        if [ -d "${DEPLOY_DIR}/.git" ]; then
                            echo "Repository exists, pulling latest changes..." &&
                            cd ${DEPLOY_DIR} &&
                            git fetch origin dev &&
                            git reset --hard origin/dev &&
                            echo "Repository updated to origin/dev"
                        else
                            echo "Repository not found, cloning..." &&
                            mkdir -p ${DEPLOY_DIR} &&
                            git clone --branch dev ${GIT_URL} ${DEPLOY_DIR} &&
                            echo "Repository cloned at ${DEPLOY_DIR}"
                        fi
                    '
                """
            }
        }

        stage('Config') {
            when { branch 'dev' }
            steps {
                sh "ssh ${SSH_OPTS} ${DEPLOY_USER}@${DEPLOY_HOST} 'rm -f ${DEPLOY_DIR}/.env'"

                withCredentials([file(credentialsId: "${PROJECT_NAME}-env-${env.APP_ENV}", variable: 'ENV_FILE')]) {
                    sh """
                        scp ${SSH_OPTS} \
                            ${ENV_FILE} \
                            ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_DIR}/.env
                        echo ".env file deployed"
                    """
                }

                sh """
                    ssh ${SSH_OPTS} ${DEPLOY_USER}@${DEPLOY_HOST} '
                        cd ${DEPLOY_DIR} &&
                        test -s .env || { echo "Missing .env file"; exit 1; }
                        grep -q "^PUBLIC_SUPABASE_URL="      .env || { echo "Missing PUBLIC_SUPABASE_URL";      exit 1; }
                        grep -q "^PUBLIC_SUPABASE_ANON_KEY=" .env || { echo "Missing PUBLIC_SUPABASE_ANON_KEY"; exit 1; }
                        grep -q "^DOCKER_SUBNET="            .env || { echo "Missing DOCKER_SUBNET";            exit 1; }
                    '
                """
            }
        }

        stage('Build') {
            when { branch 'dev' }
            steps {
                sh """
                    ssh ${SSH_OPTS} ${DEPLOY_USER}@${DEPLOY_HOST} '
                        set -e
                        cd ${DEPLOY_DIR}

                        echo "Backing up web image..."
                        docker tag ${PROJECT_NAME}-${APP_ENV}-web:latest \
                            ${PROJECT_NAME}-${APP_ENV}-web:backup-${BUILD_NUMBER} 2>/dev/null || true

                        echo "Building web image..."
                        ENV=${APP_ENV} docker compose --env-file .env build web
                        echo "Web image built"
                    '
                """
            }
        }

        stage('Deploy') {
            when { branch 'dev' }
            steps {
                sh """
                    ssh ${SSH_OPTS} ${DEPLOY_USER}@${DEPLOY_HOST} '
                        set -e
                        cd ${DEPLOY_DIR}

                        SUBNET=\$(grep "^DOCKER_SUBNET=" .env | cut -d= -f2)
                        docker network inspect ${PROJECT_NAME}-${APP_ENV} >/dev/null 2>&1 || \
                            docker network create --driver bridge --subnet \$SUBNET ${PROJECT_NAME}-${APP_ENV}

                        echo "Deploying service..."
                        ENV=${APP_ENV} docker compose --env-file .env up -d --force-recreate --remove-orphans

                        echo "Service deployed"
                        ENV=${APP_ENV} docker compose ps
                    '
                """
            }
        }

        stage('Health Check') {
            when { branch 'dev' }
            steps {
                sh """
                    ssh ${SSH_OPTS} ${DEPLOY_USER}@${DEPLOY_HOST} '
                        CONTAINER="${PROJECT_NAME}-${APP_ENV}-web"
                        CONTAINER_IP=\$(docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" \$CONTAINER)
                        echo "Container IP: \$CONTAINER_IP"
                        for i in \$(seq 1 10); do
                            curl -sf http://\${CONTAINER_IP}:80 >/dev/null && echo "Health check passed" && exit 0
                            echo "Attempt \$i/10 failed, retrying in 5s..."
                            sleep 5
                        done
                        echo "ERROR: Health check failed after 10 attempts"
                        exit 1
                    '
                """
            }
        }

        stage('Cleanup') {
            when {
                allOf {
                    branch 'dev'
                    expression { currentBuild.result == null || currentBuild.result == 'SUCCESS' }
                }
            }
            steps {
                sh """
                    ssh ${SSH_OPTS} ${DEPLOY_USER}@${DEPLOY_HOST} '
                        echo "Cleaning up old images..."
                        docker images "${PROJECT_NAME}-${APP_ENV}-web" \
                            --format "table {{.CreatedAt}}\\t{{.ID}}\\t{{.Tag}}" | grep "backup-" | \
                            awk "NR>4{print \\\$2}" | \
                            xargs -r docker rmi --force 2>/dev/null || true

                        docker image prune -af --filter "until=72h"
                        echo "Cleanup completed"
                    '
                """
            }
        }

    }

    post {
        success {
            script {
                if (env.DEPLOY_USER && env.DEPLOY_HOST && env.DEPLOY_DIR) {
                    sh "ssh ${SSH_OPTS} ${DEPLOY_USER}@${DEPLOY_HOST} 'rm -f ${DEPLOY_DIR}/.env' || true"
                }
            }
            echo "Deploy to ${APP_ENV} (dev) completed successfully"
        }
        failure {
            echo "Deploy to ${APP_ENV} (dev) failed"
            script {
                if (env.DEPLOY_USER && env.DEPLOY_HOST && env.DEPLOY_DIR) {
                    sh """
                        ssh ${SSH_OPTS} ${DEPLOY_USER}@${DEPLOY_HOST} '
                            echo "Attempting rollback..."
                            cd ${DEPLOY_DIR}
                            docker tag ${PROJECT_NAME}-${APP_ENV}-web:backup-${BUILD_NUMBER} \
                                ${PROJECT_NAME}-${APP_ENV}-web:latest 2>/dev/null || true
                            ENV=${APP_ENV} docker compose --env-file .env up -d || true
                            rm -f ${DEPLOY_DIR}/.env
                        ' || true
                    """
                }
            }
        }
    }
}
