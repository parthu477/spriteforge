// engine/src/Log.cpp
#include "Log.h"
#include <iostream>
#include <chrono>
#include <iomanip>
#include <sstream>

std::ofstream Log::s_file;
std::mutex    Log::s_mutex;

void Log::init(const std::string& logFilePath) {
    std::lock_guard<std::mutex> lock(s_mutex);
    s_file.open(logFilePath, std::ios::app);
}

void Log::info(const std::string& msg)  { write("INFO ", msg); }
void Log::warn(const std::string& msg)  { write("WARN ", msg); }
void Log::error(const std::string& msg) { write("ERROR", msg); }

void Log::write(const std::string& level, const std::string& msg) {
    std::lock_guard<std::mutex> lock(s_mutex);
    std::string line = "[" + timestamp() + "] [" + level + "] " + msg;
    std::cout << line << "\n";
    if (s_file.is_open()) {
        s_file << line << "\n";
        s_file.flush();
    }
}

std::string Log::timestamp() {
    auto now = std::chrono::system_clock::now();
    auto t   = std::chrono::system_clock::to_time_t(now);
    std::ostringstream oss;
    oss << std::put_time(std::gmtime(&t), "%Y-%m-%dT%H:%M:%SZ");
    return oss.str();
}
