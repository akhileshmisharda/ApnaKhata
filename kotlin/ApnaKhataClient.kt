package com.example.apnakhata

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Data Classes for Type-Safe Jamabandi Record
 */
data class KhasraRecord(
    val khataNo: String,
    val khasraNo: String,
    val rakbaHectare: String,
    val irrigation: String,
    val soilAndTax: String
)

data class JamabandiResult(
    val success: Boolean,
    val district: String,
    val tehsil: String,
    val village: String,
    val khataNumber: String,
    val nakalType: String,
    val nakalPeriod: String,
    val searchMode: String,
    val owners: List<String>,
    val totalKhasraCount: Int,
    val totalRakbaHectare: String?,
    val khasraRecords: List<KhasraRecord>,
    val rawJson: String
)

/**
 * Apna Khata Client for Android / Kotlin
 * Can be added to any Android app or Kotlin project.
 */
object ApnaKhataClient {

    // Default Live Cloud API Endpoint
    private const val API_BASE_URL = "https://apnakhata-juof.onrender.com/api/jamabandi"
    
    // Fallback Domain (fabkraft.in)
    // private const val API_BASE_URL = "http://fabkraft.in/api.php"

    /**
     * Fetch Jamabandi as raw JSON String (Coroutine Suspend Function)
     *
     * @param district District name in Hindi or English (e.g., "भीलवाड़ा")
     * @param tehsil Tehsil name in Hindi or English (e.g., "बनेड़ा")
     * @param village Village name in Hindi or English (e.g., "रायला - रायला - रायला")
     * @param khata Khata Number (e.g., "560")
     * @return Raw JSON String response from server
     */
    suspend fun getJamabandiJson(
        district: String = "भीलवाड़ा",
        tehsil: String = "बनेड़ा",
        village: String = "रायला - रायला - रायला",
        khata: String = "560"
    ): String = withContext(Dispatchers.IO) {
        val queryUrl = buildString {
            append(API_BASE_URL)
            append("?district=").append(URLEncoder.encode(district.trim(), "UTF-8"))
            append("&tehsil=").append(URLEncoder.encode(tehsil.trim(), "UTF-8"))
            append("&village=").append(URLEncoder.encode(village.trim(), "UTF-8"))
            append("&khata=").append(URLEncoder.encode(khata.trim(), "UTF-8"))
        }

        val url = URL(queryUrl)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 60000 // 60 seconds
            readTimeout = 180000    // 180 seconds for scraper
            setRequestProperty("Accept", "application/json")
        }

        try {
            val responseCode = connection.responseCode
            val inputStream = if (responseCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream ?: connection.inputStream
            }

            BufferedReader(InputStreamReader(inputStream, "UTF-8")).use { reader ->
                reader.readText()
            }
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Fetch Jamabandi and parse directly into Kotlin Object
     *
     * @param district e.g., "भीलवाड़ा"
     * @param tehsil e.g., "बनेड़ा"
     * @param village e.g., "रायला - रायला - रायला"
     * @param khata e.g., "560"
     * @return Parsed [JamabandiResult] object with owners and khasra details
     */
    suspend fun getJamabandi(
        district: String = "भीलवाड़ा",
        tehsil: String = "बनेड़ा",
        village: String = "रायला - रायला - रायला",
        khata: String = "560"
    ): Result<JamabandiResult> = runCatching {
        val jsonStr = getJamabandiJson(district, tehsil, village, khata)
        val root = JSONObject(jsonStr)

        if (!root.optBoolean("success", false)) {
            val errMsg = root.optString("message", "Failed to extract Jamabandi record")
            throw Exception(errMsg)
        }

        val data = root.getJSONObject("data")
        val options = data.optJSONObject("selectedOptions")

        // Parse Owners List
        val ownersJson = data.optJSONArray("owners")
        val ownersList = mutableListOf<String>()
        if (ownersJson != null) {
            for (i in 0 until ownersJson.length()) {
                ownersList.add(ownersJson.getString(i))
            }
        }

        // Parse Khasra Records
        val khasraJson = data.optJSONArray("khasraRecords")
        val khasraList = mutableListOf<KhasraRecord>()
        if (khasraJson != null) {
            for (i in 0 until khasraJson.length()) {
                val item = khasraJson.getJSONObject(i)
                khasraList.add(
                    KhasraRecord(
                        khataNo = item.optString("khataNo", ""),
                        khasraNo = item.optString("khasraNo", ""),
                        rakbaHectare = item.optString("rakbaHectare", ""),
                        irrigation = item.optString("irrigation", "-"),
                        soilAndTax = item.optString("soilAndTax", "")
                    )
                )
            }
        }

        JamabandiResult(
            success = true,
            district = data.optString("district", district),
            tehsil = data.optString("tehsil", tehsil),
            village = data.optString("village", village),
            khataNumber = data.optString("khataNumber", khata),
            nakalType = options?.optString("nakalType", "जमाबंदी की प्रतिलिपि") ?: "जमाबंदी की प्रतिलिपि",
            nakalPeriod = options?.optString("nakalPeriod", "वर्तमान नकल") ?: "वर्तमान नकल",
            searchMode = options?.optString("searchMode", "खाता से") ?: "खाता से",
            owners = ownersList,
            totalKhasraCount = data.optInt("totalKhasraCount", khasraList.size),
            totalRakbaHectare = data.optString("totalRakbaHectare", null),
            khasraRecords = khasraList,
            rawJson = jsonStr
        )
    }
}

