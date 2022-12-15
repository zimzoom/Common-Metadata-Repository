FROM clojure:openjdk-8-lein

# this is a non-interactive automated build - avoid some warning messages
# ENV DEBIAN_FRONTEND noninteractive

# update dpkg repositories
RUN apt-get update 

# Getting Maven
# install wget
RUN apt-get install -y wget
# get maven 3.3.9
RUN wget --no-verbose -O /tmp/apache-maven-3.3.9.tar.gz http://archive.apache.org/dist/maven/maven-3/3.3.9/binaries/apache-maven-3.3.9-bin.tar.gz
# verify checksum
RUN echo "516923b3955b6035ba6b0a5b031fbd8b /tmp/apache-maven-3.3.9.tar.gz" | md5sum -c
# install maven
RUN tar xzf /tmp/apache-maven-3.3.9.tar.gz -C /opt/
RUN ln -s /opt/apache-maven-3.3.9 /opt/maven
RUN ln -s /opt/maven/bin/mvn /usr/local/bin
RUN rm -f /tmp/apache-maven-3.3.9.tar.gz
ENV MAVEN_HOME /opt/maven

# Install Ruby.
RUN \
  apt-get update && \
  apt-get install -y ruby

# included in base image?
# Install gcc
# RUN apt-get update && \
#     apt-get -y install gcc mono-mcs && \
#     rm -rf /var/lib/apt/lists/*

# remove download archive files
RUN apt-get clean

# Copy CMR for build process - make sure oracle-libs/support contains the jars
COPY . /cmr
WORKDIR /cmr
#CMD ["/bin/cmr" "setup" "dev"]
RUN /bin/bash -c './bin/cmr setup dev'