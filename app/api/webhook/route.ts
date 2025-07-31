import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get("audio") as File

    console.log("API Route received audio file:", {
      name: audioFile?.name,
      size: audioFile?.size,
      type: audioFile?.type,
    })

    if (!audioFile) {
      throw new Error("No audio file received")
    }

    // Create FormData for the webhook
    const webhookFormData = new FormData()
    webhookFormData.append("audio", audioFile, "audio.webm")

    console.log("Sending audio to n8n webhook... (this may take a while)")

    // Set a longer timeout for n8n response (5 minutes)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 300000) // 5 minutes

    try {
      const response = await fetch(
        "https://evxautoai.app.n8n.cloud/webhook/7d3e6612-1fe0-44bc-bdaf-60b83d189219",
        {
          method: "POST",
          body: webhookFormData,
          signal: controller.signal,
        },
      )

      clearTimeout(timeoutId)

      console.log("n8n webhook response status:", response.status)
      console.log("n8n webhook response headers:", Object.fromEntries(response.headers.entries()))

      // Get the response text first
      const responseText = await response.text()
      console.log("n8n webhook raw response:", responseText.substring(0, 500) + "...")

      if (!response.ok) {
        console.error("n8n webhook error response:", responseText)
        throw new Error(`n8n webhook responded with status: ${response.status} - ${responseText.substring(0, 200)}`)
      }

      // Try to parse as JSON
      let responseData
      try {
        responseData = JSON.parse(responseText)
        console.log("n8n webhook parsed JSON data:", responseData)
      } catch (jsonError) {
        console.error("Failed to parse response as JSON:", jsonError)
        console.error("Response was:", responseText)

        // If it's not JSON, check if it might be a direct URL
        if (responseText.startsWith("http")) {
          console.log("Response appears to be a direct URL:", responseText.trim())
          return NextResponse.json({
            success: true,
            audioUrl: responseText.trim(),
            data: { audioUrl: responseText.trim() },
          })
        }

        throw new Error(`n8n webhook returned non-JSON response: ${responseText.substring(0, 100)}`)
      }

      // Validate the response structure
      if (!responseData || typeof responseData !== "object") {
        throw new Error("Invalid response format from n8n webhook")
      }

      // Check if audioUrl exists in the response
      if (!responseData.audioUrl) {
        console.warn("No audioUrl found in n8n response:", responseData)
        return NextResponse.json({
          success: false,
          error: "No audioUrl in response",
          data: responseData,
        })
      }

      // Validate audioUrl format
      const audioUrl = responseData.audioUrl
      if (typeof audioUrl !== "string" || !audioUrl.startsWith("http")) {
        throw new Error(`Invalid audioUrl format: ${audioUrl}`)
      }

      console.log("Successfully received audioUrl from n8n:", audioUrl)

      // Return the response with the audioUrl
      return NextResponse.json({
        success: true,
        audioUrl: audioUrl,
        data: responseData,
        processingTime: Date.now(),
      })
    } catch (fetchError) {
      clearTimeout(timeoutId)

      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        throw new Error("Request timed out after 5 minutes. n8n processing took too long.")
      }

      throw fetchError
    }
  } catch (error) {
    console.error("API Route error:", error)

    // Return detailed error information
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
        // For testing purposes, you can uncomment the line below to return a mock audioUrl
        // audioUrl: "https://www.soundjay.com/misc/sounds/bell-ringing-05.wav",
      },
      { status: 500 },
    )
  }
}
