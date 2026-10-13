// engine/src/Log.h — US-17 (engine side)
#pragma once
#include <string>
#include <fstream>
#include <mutex>

class Log {
public:
    static void init(const std::string& logFilePath = "engine.log");
    static void info(const std::string& msg);
    static void warn(const std::string& msg);
    static void error(const std::string& msg);

private:
    static std::string timestamp();
    static void write(const std::string& level, const std::string& msg);
    static std::ofstream s_file;
    static std::mutex    s_mutex;
};
